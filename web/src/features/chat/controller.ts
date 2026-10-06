/**
 * Native chat controller.
 *
 * Owns one `/api/ws` JSON-RPC transport, projects typed gateway events into
 * the pure reducer in `state.ts`, and exposes session lifecycle
 * (create/resume/interrupt), slash commands, attachments and human
 * approval/clarify answers. React only subscribes to snapshots.
 *
 * Invariants:
 * - Sessions are created lazily on the first send; opening an empty pane,
 *   mounting twice under StrictMode, or reconnecting never mints a session.
 * - Every async continuation captures the scope generation it started in and
 *   bails when the user moved to another conversation/profile, so a late
 *   reply can never bind an old runtime id to a new scope or clear newer
 *   composer state.
 * - Approval/clarify asks always require an explicit user answer. Requests
 *   that belong to another conversation are retained (not silently denied)
 *   and re-shown when that conversation is opened again.
 * - Any other interactive prompt fails visibly instead of hanging the agent.
 */
import {
  JSON_RPC_METHOD_NOT_FOUND,
  JsonRpcGatewayError,
  looksLikeSlashCommand,
  parseCommandDispatch,
  parseSlashCommand,
  reconnectBackoffDelayMs,
  skillInvocationText,
  type ApprovalCancelledPayload,
  type ApprovalChoice,
  type ApprovalRequestParams,
  type AttachedImageResult,
  type ClarifyRequestParams,
  type CommandDispatchResult,
  type CommandDispatchResponse,
  type ConnectionState,
  type ErrorPayload,
  type GatewayEvent,
  type GatewayEventName,
  type MessageCompletePayload,
  type MessageInterimPayload,
  type RequestCancelPayload,
  type ServerRequest,
  type SessionCreateResult,
  type SessionHistoryResult,
  type SessionInterruptResult,
  type SessionLiveInfo,
  type SessionReclaimedPayload,
  type SessionResumeResult,
  type SessionTitlePayload,
  type SessionUsagePayload,
  type SlashExecResult,
  type StatusUpdatePayload,
  type StreamDeltaPayload,
  type ToolCompletePayload,
  type ToolStartPayload,
} from "@hermes/shared";

import { fileToBase64 } from "./files";
import { chatReducer, createInitialChatState, type ChatAction } from "./state";
import type { ChatModelSelection, ChatState } from "./types";

export interface ChatTransport {
  readonly connectionState: ConnectionState;
  connect(): Promise<void>;
  close(): void;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  on<K extends GatewayEventName>(
    type: K,
    handler: (event: GatewayEvent<K>) => void,
  ): () => void;
  onState(handler: (state: ConnectionState) => void): () => void;
  onRequest(handler: (request: ServerRequest) => boolean | void): () => void;
  /** Shared-client reconnect barrier (absent on simple test transports). */
  sessionReplayBarrier?(sessionId: string): Promise<boolean> | undefined;
}

export interface ChatSnapshot extends ChatState {
  connection: ConnectionState;
  /** True while the reconnect ladder has a redial scheduled. */
  retrying: boolean;
  reconnectAttempt: number;
}

export interface ChatControllerOptions {
  transport: ChatTransport;
  profile: string;
  /** `/undo` and other prefill directives drop text back into the composer. */
  onPrefill?: (text: string) => void;
  /** The rail refetches when the backend says sessions changed. */
  onSessionsChanged?: () => void;
  /** `/copy` copies the last assistant reply. */
  onCopyLast?: () => void;
  /** Injectable clock for tests. */
  now?: () => number;
}

export const MAX_RECONNECT_ATTEMPTS = 15;

const BRIDGE_EVENT_TYPES: GatewayEventName[] = [
  "message.start",
  "message.delta",
  "message.interim",
  "reasoning.delta",
  "tool.start",
  "tool.complete",
  "message.complete",
  "session.info",
  "session.title",
  "session.usage",
  "session.reclaimed",
  "status.update",
  "sessions.changed",
  "request.cancel",
  "approval.cancelled",
  "error",
];

/** Thrown internally when the user changed scope during an await. */
class StaleScopeError extends Error {
  constructor() {
    super("the conversation changed");
    this.name = "StaleScopeError";
  }
}

function isSessionGone(error: unknown): boolean {
  if (error instanceof JsonRpcGatewayError && error.code === 4007) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /session not found|unknown session|no such session/i.test(message);
}

export function isAmbiguousTimeout(error: unknown): boolean {
  return /request timed out/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

interface SessionHandle {
  runtime: string;
  stored: string;
}

export class ChatController {
  private readonly transport: ChatTransport;
  private readonly options: ChatControllerOptions;
  private readonly now: () => number;
  private readonly listeners = new Set<(snapshot: ChatSnapshot) => void>();
  private readonly unsubscribers: Array<() => void> = [];
  /** Visible approval/clarify requests by server request id. */
  private readonly handles = new Map<string, ServerRequest>();
  /** Requests for other conversations, keyed by their session id. */
  private readonly retained = new Map<string, ServerRequest[]>();

  private state: ChatState;
  private connection: ConnectionState;
  private retrying = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private everConnected = false;
  private disposed = false;
  private generation = 0;
  private idSeq = 0;
  private createHandle: { generation: number; promise: Promise<SessionHandle | null> } | null =
    null;
  private createKey: string | null = null;
  /** Stored session waiting for the transport to open before resume. */
  private pendingOpenSession: { stored: string; generation: number } | null = null;
  private pendingModel: ChatModelSelection | null = null;
  private workspaceCwd = "";

  constructor(options: ChatControllerOptions) {
    this.transport = options.transport;
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.state = createInitialChatState(options.profile);
    this.connection = options.transport.connectionState;

    for (const type of BRIDGE_EVENT_TYPES) {
      this.unsubscribers.push(
        this.transport.on(type, (event) => this.handleEvent(event)),
      );
    }
    this.unsubscribers.push(this.transport.onState((state) => this.handleState(state)));
    this.unsubscribers.push(
      this.transport.onRequest((request) => this.handleServerRequest(request)),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Subscription                                                      */
  /* ---------------------------------------------------------------- */

  subscribe(listener: (snapshot: ChatSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): ChatSnapshot {
    return {
      ...this.state,
      connection: this.connection,
      retrying: this.retrying,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private dispatch(action: ChatAction): void {
    const previous = this.state;
    const next = chatReducer(previous, action);
    if (next === previous) return;
    this.state = next;
    this.emit();
  }

  private notice(text: string, tone: "info" | "error" = "info"): void {
    this.idSeq += 1;
    this.dispatch({
      type: "notice/append",
      id: `notice:${this.idSeq}:${this.now()}`,
      text,
      tone,
    });
  }

  /** True when `token` still names the current scope. */
  private isCurrent(token: number): boolean {
    return !this.disposed && this.generation === token;
  }

  /* ---------------------------------------------------------------- */
  /* Connection lifecycle                                              */
  /* ---------------------------------------------------------------- */

  async connect(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.transport.connect();
    } catch (error) {
      if (!this.disposed) {
        this.handleState("error");
        if (this.connection === "error") {
          this.dispatch({ type: "error", message: errorMessage(error) });
        }
      }
    }
  }

  retryNow(): void {
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    if (this.connection !== "open" && this.connection !== "connecting") {
      this.handleState("connecting");
      void this.connect();
    }
  }

  private handleState(state: ConnectionState): void {
    if (this.disposed) return;
    const changed = this.connection !== state;
    this.connection = state;
    if (changed) this.emit();

    if (state === "open") {
      const wasConnected = this.everConnected;
      this.everConnected = true;
      this.reconnectAttempt = 0;
      this.retrying = false;
      this.clearReconnectTimer();
      if (changed) this.emit();
      if (this.pendingOpenSession) {
        const pending = this.pendingOpenSession;
        this.pendingOpenSession = null;
        if (this.isCurrent(pending.generation)) {
          void this.openSession(pending.stored, { replaceItems: true });
        }
        return;
      }
      if (wasConnected) void this.recoverAfterReconnect();
      return;
    }

    if ((state === "closed" || state === "error") && !this.disposed) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.retrying = false;
      this.emit();
      return;
    }
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    this.retrying = true;
    this.emit();
    const delay = Math.min(
      reconnectBackoffDelayMs(attempt, { baseDelayMs: 1_000, capMs: 30_000, jitter: false }),
      30_000,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Session lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Bind the controller to a profile and (optional) stored session. Re-binding
   * to the same scope is a no-op so URL/storage effects are idempotent.
   */
  setScope(profile: string, storedSessionId: string | null): void {
    const stored = storedSessionId || null;
    if (this.state.profile === profile && this.state.storedSessionId === stored) {
      return;
    }
    this.generation += 1;
    // ANY scope change (including profile-only / explicit new) invalidates a
    // deferred resume; otherwise the next socket open would reopen the old
    // conversation under the new profile.
    this.pendingOpenSession = null;
    this.parkVisibleRequests();
    if (this.state.profile !== profile) {
      this.pendingModel = null;
    }
    this.createKey = null;
    this.createHandle = null;
    this.dispatch({ type: "scope/reset", profile, storedSessionId: stored });
    if (stored) this.openSession(stored, { replaceItems: true });
  }

  /** Open (resume) a stored session as the visible conversation. */
  async openSession(
    storedSessionId: string,
    options: { replaceItems?: boolean } = {},
  ): Promise<void> {
    const stored = storedSessionId.trim();
    if (!stored) return;
    const replaceItems = options.replaceItems !== false;
    const generation = ++this.generation;
    this.parkVisibleRequests();
    this.clearRecoveryTimer();
    // Never paint the previous conversation while the resume is in flight.
    this.dispatch({ type: "history/replace", messages: [] });
    this.dispatch({
      type: "session/snapshot",
      storedSessionId: stored,
      hydrating: true,
      replaceItems,
    });
    if (this.connection !== "open") {
      // The browser can mount on /chat before the socket's first open; resume
      // once connected instead of failing as "gateway not connected".
      this.pendingOpenSession = { stored, generation };
      return;
    }
    try {
      const result = await this.request<SessionResumeResult>("session.resume", {
        session_id: stored,
        ...this.profileParams(),
      });
      if (!this.isCurrent(generation)) return;
      this.applySnapshot(result, { replaceItems });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.dispatch({ type: "session/snapshot", hydrating: false });
      if (isSessionGone(error)) {
        this.dispatch({
          type: "session/ended",
          reason: "That conversation is no longer available.",
        });
      } else {
        this.dispatch({ type: "error", message: errorMessage(error) });
      }
    }
  }

  /** Reset to an unsaved conversation; existing sessions are untouched. */
  newSession(): void {
    this.generation += 1;
    this.parkVisibleRequests();
    this.clearRecoveryTimer();
    this.createHandle = null;
    this.createKey = null;
    this.pendingOpenSession = null;
    this.dispatch({
      type: "scope/reset",
      profile: this.state.profile,
      storedSessionId: null,
    });
  }

  /** Remember the model a *new* session should be created with. */
  setPendingModel(model: ChatModelSelection | null): void {
    this.pendingModel = model;
  }

  /** Working directory a fresh session should start in (explicit pick only). */
  setWorkspaceCwd(cwd: string): void {
    this.workspaceCwd = cwd.trim();
  }

  /**
   * Lazily create (or re-attach) the live session. Concurrent callers within
   * one scope share a single request; a scope change invalidates the old
   * promise so it can never bind into the new conversation.
   */
  private ensureSession(token: number): Promise<SessionHandle | null> {
    if (this.createHandle && this.createHandle.generation === token) {
      return this.createHandle.promise;
    }
    const promise = this.runEnsure(token).finally(() => {
      if (this.createHandle?.promise === promise) this.createHandle = null;
    });
    this.createHandle = { generation: token, promise };
    return promise;
  }

  private async runEnsure(token: number): Promise<SessionHandle | null> {
    if (!this.isCurrent(token)) return null;
    if (this.state.runtimeSessionId && !this.state.sessionEnded) {
      return {
        runtime: this.state.runtimeSessionId,
        stored: this.state.storedSessionId ?? this.state.runtimeSessionId,
      };
    }
    const stored = this.state.storedSessionId;
    if (stored) {
      try {
        const resumed = await this.request<SessionResumeResult>("session.resume", {
          session_id: stored,
          omit_messages: true,
          ...this.profileParams(),
        });
        if (!this.isCurrent(token)) return null;
        this.applySnapshot(resumed, { replaceItems: false });
        return {
          runtime: resumed.session_id,
          stored: resumed.stored_session_id ?? stored,
        };
      } catch (error) {
        if (!this.isCurrent(token)) return null;
        if (!isSessionGone(error)) throw error;
        this.dispatch({
          type: "scope/reset",
          profile: this.state.profile,
          storedSessionId: null,
        });
      }
    }
    return this.createFreshSession(token);
  }

  /** Public for tests: create the live session now (used on first send). */
  async createSessionIfNeeded(): Promise<SessionHandle | null> {
    return this.ensureSession(this.generation);
  }

  private async createFreshSession(token: number): Promise<SessionHandle | null> {
    // Stable caller key: an ambiguous create retried by the user returns the
    // SAME session instead of minting a duplicate.
    const key = (this.createKey ??= newIdempotencyKey());
    try {
      const created = await this.request<SessionCreateResult>("session.create", {
        source: "dashboard",
        idempotency_key: key,
        ...this.profileParams(),
        ...(this.workspaceCwd
          ? { cwd: this.workspaceCwd, cwd_explicit: true }
          : {}),
        ...(this.pendingModel
          ? { model: this.pendingModel.model, provider: this.pendingModel.provider }
          : {}),
      });
      if (!this.isCurrent(token)) return null;
      this.createKey = null;
      this.pendingModel = null;
      this.dispatch({
        type: "session/linked",
        storedSessionId: created.stored_session_id,
        runtimeSessionId: created.session_id,
      });
      this.applySnapshot(created, { replaceItems: false });
      return { runtime: created.session_id, stored: created.stored_session_id };
    } catch (error) {
      // Keep the key only for an ambiguous (timed-out) create so an explicit
      // retry is idempotent; a definite refusal starts a new identity.
      if (this.isCurrent(token) && !isAmbiguousTimeout(error)) this.createKey = null;
      throw error;
    }
  }

  /** The session id to pass to RPCs, preferring the live runtime id. */
  private activeSessionId(): string | null {
    return this.state.runtimeSessionId ?? this.state.storedSessionId;
  }

  private profileParams(): Record<string, unknown> {
    return this.state.profile ? { profile: this.state.profile } : {};
  }

  private async request<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    return this.transport.request<T>(method, params);
  }

  /**
   * Apply a live session snapshot and surface any retained requests that now
   * belong to the bound conversation.
   */
  private applySnapshot(
    result: {
      stored_session_id?: string | null;
      session_id: string;
      info?: SessionLiveInfo | null;
      messages?: SessionResumeResult["messages"];
      inflight?: SessionResumeResult["inflight"];
      running?: boolean | null;
      queued?: SessionResumeResult["queued"];
      hydrating?: boolean | null;
    },
    options: { replaceItems: boolean },
  ): void {
    this.dispatch({
      type: "session/snapshot",
      storedSessionId: result.stored_session_id ?? undefined,
      runtimeSessionId: result.session_id,
      info: result.info,
      messages: options.replaceItems ? result.messages : undefined,
      inflight: result.inflight,
      running: result.running ?? undefined,
      queued: result.queued?.user ?? null,
      hydrating: false,
      replaceItems: options.replaceItems,
    });
    this.drainRetained();
  }

  /* ---------------------------------------------------------------- */
  /* Sending                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Submit a user turn. Returns false when nothing was accepted, so the
   * composer can restore the draft. The optimistic user bubble is removed on
   * failure; no automatic resend ever happens.
   */
  async send(text: string, files: File[] = []): Promise<boolean> {
    if (this.state.sendPhase !== "idle") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    const token = this.generation;
    this.dispatch({
      type: "send/phase",
      phase: this.state.runtimeSessionId ? "submitting" : "creating",
    });
    try {
      if (files.length === 0 && looksLikeSlashCommand(trimmed)) {
        return await this.runSlash(trimmed, 0, token);
      }
      return await this.submitPrompt(trimmed, undefined, files, token);
    } finally {
      if (this.isCurrent(token) && this.state.sendPhase !== "idle") {
        this.dispatch({ type: "send/phase", phase: "idle" });
      }
    }
  }

  private async submitPrompt(
    text: string,
    displayText: string | undefined,
    files: File[],
    token: number,
  ): Promise<boolean> {
    if (!text.trim()) return false;
    this.idSeq += 1;
    const localId = `local:${this.idSeq}:${this.now()}`;
    this.dispatch({
      type: "user/append",
      id: localId,
      text: displayText ?? text,
      timestamp: this.now() / 1000,
    });
    try {
      const session = await this.ensureSession(token);
      if (!session) throw new Error("Could not start a conversation.");
      if (!this.isCurrent(token)) throw new StaleScopeError();
      if (this.state.storedSessionId !== session.stored) {
        this.dispatch({
          type: "session/linked",
          storedSessionId: session.stored,
          runtimeSessionId: session.runtime,
        });
      }
      if (files.length > 0) {
        await this.attachImages(session.runtime, files, token);
      }
      // A completion can arrive before this response; only start the running
      // state if no turn ended while we waited.
      const turnVersionBefore = this.state.turnVersion;
      await this.request("prompt.submit", {
        session_id: session.runtime,
        text,
        ...this.profileParams(),
      });
      if (!this.isCurrent(token)) return false;
      if (this.state.turnVersion === turnVersionBefore) {
        this.dispatch({ type: "turn/start" });
      }
      return true;
    } catch (error) {
      if (error instanceof StaleScopeError || !this.isCurrent(token)) return false;
      const message = errorMessage(error);
      const ambiguous = isAmbiguousTimeout(error);
      this.dispatch({ type: "user/remove", id: localId });
      this.notice(
        ambiguous
          ? "Delivery unknown: the request timed out. The message may not have been accepted — check the conversation before resending."
          : `Message not sent: ${message}`,
        "error",
      );
      this.dispatch({ type: "error", message });
      if (ambiguous) {
        const sessionId = this.activeSessionId();
        if (sessionId) {
          void this.recoverLiveState(sessionId, token, { history: true });
        }
      }
      return false;
    }
  }

  private async attachImages(
    runtimeSessionId: string,
    files: File[],
    token: number,
  ): Promise<void> {
    for (const file of files) {
      const content = await fileToBase64(file);
      if (!this.isCurrent(token)) throw new StaleScopeError();
      const result = await this.request<AttachedImageResult>("image.attach_bytes", {
        session_id: runtimeSessionId,
        content_base64: content,
        filename: file.name || "attachment",
        ...this.profileParams(),
      });
      if (!this.isCurrent(token)) throw new StaleScopeError();
      if (!result?.attached) {
        throw new Error(result?.message || `Could not attach ${file.name || "image"}.`);
      }
    }
  }

  /** Stop the running turn. */
  async interrupt(): Promise<void> {
    const token = this.generation;
    const sessionId = this.activeSessionId();
    if (!sessionId || this.state.sendPhase === "stopping") return;
    this.dispatch({ type: "send/phase", phase: "stopping" });
    try {
      const result = await this.request<SessionInterruptResult>("session.interrupt", {
        session_id: sessionId,
        ...this.profileParams(),
      });
      if (!this.isCurrent(token)) return;
      this.dispatch({ type: "send/phase", phase: "idle" });
      if (result?.status === "interrupted") {
        // The authoritative `message.complete {status: interrupted}` normally
        // follows; settle locally if this transport never delivers it.
        this.clearRecoveryTimer();
        this.recoveryTimer = setTimeout(() => {
          this.recoveryTimer = null;
          if (this.isCurrent(token) && this.state.running) {
            this.dispatch({
              type: "turn/complete",
              payload: { status: "interrupted" },
            });
          }
        }, 8_000);
      }
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.dispatch({ type: "send/phase", phase: "idle" });
      this.dispatch({ type: "error", message: errorMessage(error) });
    }
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Slash commands                                                    */
  /* ---------------------------------------------------------------- */

  private async runSlash(
    text: string,
    depth = 0,
    token = this.generation,
  ): Promise<boolean> {
    if (depth > 3) {
      this.notice("Command alias chain is too long.", "error");
      return false;
    }
    if (!this.isCurrent(token)) return false;
    const { name, arg } = parseSlashCommand(text);
    if (!name) return this.submitPrompt(text, undefined, [], token);
    if (name === "new" || name === "clear") {
      this.newSession();
      return true;
    }
    if (name === "stop" || name === "abort") {
      void this.interrupt();
      return true;
    }
    if (name === "copy") {
      this.options.onCopyLast?.();
      return true;
    }

    let sessionId = this.activeSessionId();
    if (!sessionId) {
      const created = await this.ensureSession(token);
      if (!this.isCurrent(token)) return false;
      sessionId = created?.runtime ?? null;
    }
    if (!sessionId) {
      this.notice(`/${name}: could not start a conversation.`, "error");
      return false;
    }

    let dispatch: CommandDispatchResponse | null = null;
    let output: string | null = null;
    let slashError: unknown = null;
    try {
      const result = await this.request<SlashExecResult>("slash.exec", {
        session_id: sessionId,
        command: text.replace(/^\/+/, ""),
        ...this.profileParams(),
      });
      if (!this.isCurrent(token)) return false;
      if (result?.type) {
        dispatch = parseCommandDispatch(result);
      } else if (typeof result?.output === "string") {
        output = result.warning
          ? `warning: ${result.warning}\n${result.output}`
          : result.output;
      }
    } catch (error) {
      if (!this.isCurrent(token)) return false;
      // Only a DEFINITIVE "not a quick/plugin/skill command" may fall through
      // to command.dispatch; a timeout/crash must not replay an effectful
      // command through the other path.
      const message = errorMessage(error);
      if (!/not a quick\/plugin\/(?:bundle\/)?skill command/i.test(message)) {
        this.notice(`error: ${message}`, "error");
        return false;
      }
      slashError = error;
    }

    if (!dispatch && output === null && slashError) {
      try {
        const result = await this.request<CommandDispatchResult>("command.dispatch", {
          name,
          arg: arg || null,
          session_id: sessionId,
          ...this.profileParams(),
        });
        if (!this.isCurrent(token)) return false;
        dispatch = parseCommandDispatch(result);
      } catch (error) {
        if (!this.isCurrent(token)) return false;
        this.notice(`error: ${errorMessage(error)}`, "error");
        return false;
      }
    }

    if (output !== null) {
      this.notice(output || "(no output)");
      return true;
    }
    if (!dispatch) {
      this.notice(`error: invalid response from ${name}`, "error");
      return false;
    }
    return this.handleDispatch(dispatch, name, arg, depth, token);
  }

  private async handleDispatch(
    dispatch: CommandDispatchResponse,
    name: string,
    arg: string,
    depth: number,
    token: number,
  ): Promise<boolean> {
    if (!this.isCurrent(token)) return false;
    if (dispatch.type === "exec" || dispatch.type === "plugin") {
      this.notice(dispatch.output ?? "(no output)");
      return true;
    }
    if (dispatch.type === "alias") {
      return this.runSlash(
        `/${dispatch.target}${arg ? ` ${arg}` : ""}`,
        depth + 1,
        token,
      );
    }
    if ((dispatch.type === "send" || dispatch.type === "prefill") && dispatch.notice?.trim()) {
      this.notice(dispatch.notice.trim());
    }
    const message = ("message" in dispatch && dispatch.message ? dispatch.message : "").trim();
    if (dispatch.type === "prefill") {
      if (message) this.options.onPrefill?.(message);
      return true;
    }
    if (!message) {
      this.notice(`/${name}: empty message`, "error");
      return false;
    }
    const projected = "display" in dispatch ? dispatch.display?.trim() : "";
    const displayText = projected || skillInvocationText(message) || undefined;
    return this.submitPrompt(message, displayText, [], token);
  }

  /* ---------------------------------------------------------------- */
  /* Server → client requests (approval / clarify)                     */
  /* ---------------------------------------------------------------- */

  private handleServerRequest(request: ServerRequest): boolean {
    const params = request.params ?? {};
    const sessionId = typeof params.session_id === "string" ? params.session_id : null;
    if (request.method === "approval" || request.method === "clarify") {
      if (!sessionId) {
        // Cannot attribute it to a conversation: fail safely and visibly.
        request.fail(
          JSON_RPC_METHOD_NOT_FOUND,
          `The dashboard chat cannot answer an unattributed "${request.method}" request.`,
        );
        this.notice(
          `An interactive "${request.method}" prompt could not be routed; open this conversation in the terminal.`,
          "error",
        );
        return true;
      }
      if (this.ownsSessionId(sessionId)) {
        this.showRequest(request);
      } else {
        // Retain (never silently deny): the user may return to that session,
        // and a resume replays the request again anyway.
        const bucket = this.retained.get(sessionId) ?? [];
        if (!bucket.some((entry) => entry.id === request.id)) bucket.push(request);
        this.retained.set(sessionId, bucket);
      }
      return true;
    }
    // Any other interactive prompt (sudo/secret/vault/preview/…): fail fast
    // and visibly. Never auto-approve and never leave the agent waiting.
    request.fail(
      JSON_RPC_METHOD_NOT_FOUND,
      `The dashboard chat cannot answer "${request.method}" requests. Use the terminal for this prompt.`,
    );
    if (this.ownsSessionId(sessionId)) {
      this.notice(
        `This conversation needs an interactive "${request.method}" prompt; open it in the terminal.`,
        "error",
      );
    }
    return true;
  }

  private showRequest(request: ServerRequest): void {
    this.handles.set(request.id, request);
    if (request.method === "approval") {
      this.dispatch({
        type: "request/add",
        request: {
          id: request.id,
          method: "approval",
          params: request.params as ApprovalRequestParams,
        },
      });
    } else {
      this.dispatch({
        type: "request/add",
        request: {
          id: request.id,
          method: "clarify",
          params: request.params as unknown as ClarifyRequestParams,
        },
      });
    }
  }

  /** Hide visible requests without answering; they stay retained per session. */
  private parkVisibleRequests(): void {
    for (const item of this.state.requests) {
      const request = this.handles.get(item.id);
      if (!request) continue;
      const sessionId =
        typeof request.params.session_id === "string" ? request.params.session_id : "";
      if (!sessionId) continue;
      const bucket = this.retained.get(sessionId) ?? [];
      if (!bucket.some((entry) => entry.id === request.id)) bucket.push(request);
      this.retained.set(sessionId, bucket);
    }
    this.handles.clear();
  }

  /** Surface retained requests whose session is now bound. */
  private drainRetained(): void {
    if (this.retained.size === 0) return;
    for (const [sessionId, bucket] of [...this.retained]) {
      if (!this.ownsSessionId(sessionId)) continue;
      for (const request of bucket) {
        if (this.handles.has(request.id)) continue;
        this.showRequest(request);
      }
      this.retained.delete(sessionId);
    }
  }

  /** Remove a request the backend withdrew (cancel / interrupt). */
  private removeRequest(requestId: string): void {
    this.handles.delete(requestId);
    for (const [sessionId, bucket] of this.retained) {
      const next = bucket.filter((request) => request.id !== requestId);
      if (next.length === 0) this.retained.delete(sessionId);
      else this.retained.set(sessionId, next);
    }
    this.dispatch({ type: "request/remove", id: requestId });
  }

  /** Answer one request safely (used only when the page is torn down). */
  private settleRequest(request: ServerRequest): void {
    if (request.method === "approval") {
      request.respond({ choice: "deny" });
    } else if (request.method === "clarify") {
      request.respond({});
    } else {
      request.fail(JSON_RPC_METHOD_NOT_FOUND, "the chat closed");
    }
    this.handles.delete(request.id);
    this.dispatch({ type: "request/remove", id: request.id });
  }

  respondApproval(
    requestId: string,
    choice: ApprovalChoice,
    options: { all?: boolean } = {},
  ): void {
    const request = this.handles.get(requestId);
    if (!request) return;
    request.respond({ choice, ...(options.all ? { all: true } : {}) });
    this.handles.delete(requestId);
    this.dispatch({ type: "request/remove", id: requestId });
  }

  respondClarify(
    requestId: string,
    answers: Record<string, string | null>,
  ): void {
    const request = this.handles.get(requestId);
    if (!request) return;
    request.respond({ answers });
    this.handles.delete(requestId);
    this.dispatch({ type: "request/remove", id: requestId });
  }

  skipClarify(requestId: string): void {
    const request = this.handles.get(requestId);
    if (!request) return;
    request.respond({});
    this.handles.delete(requestId);
    this.dispatch({ type: "request/remove", id: requestId });
  }

  /* ---------------------------------------------------------------- */
  /* Event projection                                                  */
  /* ---------------------------------------------------------------- */

  private ownsSessionId(sessionId: string | undefined | null): boolean {
    if (!sessionId) return false;
    return (
      sessionId === this.state.runtimeSessionId ||
      sessionId === this.state.storedSessionId
    );
  }

  private ownsEvent(event: GatewayEvent): boolean {
    if (!this.ownsSessionId(event.session_id)) return false;
    const eventProfile = event.profile;
    if (
      typeof eventProfile === "string" &&
      eventProfile &&
      this.state.profile &&
      eventProfile !== this.state.profile
    ) {
      return false;
    }
    return true;
  }

  private handleEvent(event: GatewayEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case "message.start":
        if (this.ownsEvent(event)) this.dispatch({ type: "turn/start" });
        return;
      case "message.delta": {
        const payload = event.payload as StreamDeltaPayload | undefined;
        if (this.ownsEvent(event) && payload?.text) {
          this.dispatch({ type: "assistant/delta", text: payload.text });
        }
        return;
      }
      case "message.interim": {
        const payload = event.payload as MessageInterimPayload | undefined;
        if (this.ownsEvent(event) && payload?.text) {
          this.dispatch({ type: "assistant/interim", text: payload.text });
        }
        return;
      }
      case "reasoning.delta": {
        const payload = event.payload as StreamDeltaPayload | undefined;
        if (this.ownsEvent(event) && payload?.text) {
          this.dispatch({ type: "reasoning/delta", text: payload.text });
        }
        return;
      }
      case "tool.start": {
        const payload = event.payload as ToolStartPayload | undefined;
        if (!this.ownsEvent(event) || !payload) return;
        this.dispatch({ type: "turn/start" });
        this.dispatch({
          type: "tool/start",
          tool: {
            id: payload.tool_id,
            name: payload.name,
            context: payload.context ?? null,
            args: payload.args ?? null,
            argsText: payload.args_text ?? null,
            preview: payload.preview ?? null,
            labels: payload.labels ?? null,
            status: "running",
          },
        });
        return;
      }
      case "tool.complete": {
        const payload = event.payload as ToolCompletePayload | undefined;
        if (!this.ownsEvent(event) || !payload) return;
        this.dispatch({
          type: "tool/complete",
          toolId: payload.tool_id,
          patch: {
            name: payload.name,
            args: payload.args ?? null,
            summary: payload.summary ?? null,
            resultText: payload.result_text ?? null,
            inlineDiff: payload.inline_diff ?? null,
            durationS: payload.duration_s ?? null,
            labels: payload.labels ?? null,
          },
        });
        return;
      }
      case "message.complete": {
        if (!this.ownsEvent(event)) return;
        this.clearRecoveryTimer();
        const payload = (event.payload as MessageCompletePayload | undefined) ?? {};
        this.dispatch({ type: "turn/complete", payload });
        if (!this.state.running) void this.refreshHistory({ merge: true });
        return;
      }
      case "session.info": {
        const payload = event.payload as SessionLiveInfo | undefined;
        if (this.ownsEvent(event) && payload) {
          this.dispatch({ type: "session/info", info: payload });
        }
        return;
      }
      case "session.title": {
        const payload = event.payload as SessionTitlePayload | undefined;
        if (this.ownsEvent(event) && payload?.title) {
          this.dispatch({ type: "session/title", title: payload.title });
        }
        return;
      }
      case "session.usage": {
        const payload = event.payload as SessionUsagePayload | undefined;
        if (this.ownsEvent(event) && payload?.usage) {
          this.dispatch({ type: "session/usage", usage: payload.usage });
        }
        return;
      }
      case "session.reclaimed": {
        const payload = event.payload as SessionReclaimedPayload | undefined;
        if (
          this.ownsSessionId(event.session_id) ||
          this.ownsSessionId(payload?.session_id)
        ) {
          this.dispatch({
            type: "session/ended",
            reason:
              "This conversation was reclaimed by the backend. Reopen it from the list to continue.",
          });
        }
        return;
      }
      case "status.update": {
        const payload = event.payload as StatusUpdatePayload | undefined;
        if (this.ownsEvent(event) && payload?.text) {
          this.dispatch({
            type: "status",
            status: { kind: payload.kind, text: payload.text },
          });
        }
        return;
      }
      case "request.cancel": {
        const payload = event.payload as RequestCancelPayload | undefined;
        if (payload?.id) this.removeRequest(payload.id);
        return;
      }
      case "approval.cancelled": {
        const payload = event.payload as ApprovalCancelledPayload | undefined;
        for (const id of payload?.request_ids ?? []) this.removeRequest(id);
        return;
      }
      case "sessions.changed":
        this.options.onSessionsChanged?.();
        return;
      case "error": {
        const payload = event.payload as ErrorPayload | undefined;
        if (!this.ownsEvent(event)) return;
        const message = coerceErrorMessage(payload);
        if (message) {
          this.dispatch({ type: "error", message });
          this.notice(message, "error");
        }
        return;
      }
      default:
        return;
    }
  }

  /* ---------------------------------------------------------------- */
  /* History reconciliation + reconnect recovery                       */
  /* ---------------------------------------------------------------- */

  /** Fetch durable history and merge/replace it into the transcript. */
  async refreshHistory(
    options: { merge?: boolean } = {},
    token = this.generation,
  ): Promise<void> {
    const sessionId = this.activeSessionId();
    if (!sessionId) return;
    try {
      const result = await this.request<SessionHistoryResult>("session.history", {
        session_id: sessionId,
        ...this.profileParams(),
      });
      if (!this.isCurrent(token)) return;
      this.dispatch(
        options.merge
          ? { type: "history/merge", messages: result.messages }
          : { type: "history/replace", messages: result.messages },
      );
    } catch {
      // History reconciliation is best-effort; the live transcript stays.
    }
  }

  private async waitForReplay(sessionId: string): Promise<void> {
    try {
      await this.transport.sessionReplayBarrier?.(sessionId);
    } catch {
      // Replay failures are non-fatal; the explicit snapshot still runs.
    }
  }

  private async recoverAfterReconnect(): Promise<void> {
    const stored = this.state.storedSessionId;
    const runtime = this.state.runtimeSessionId;
    if (!stored && !runtime) return;
    const generation = ++this.generation;
    this.parkVisibleRequests();
    this.dispatch({ type: "session/snapshot", hydrating: true });
    // Prefer the live runtime id, then fall back to the stored id: a backend
    // reclaim/restart may have dropped the runtime session while the stored
    // conversation is still resumable.
    const candidates = [runtime, stored].filter(
      (value, index, list): value is string =>
        Boolean(value) && list.indexOf(value) === index,
    );
    let lastError: unknown = null;
    for (const sessionId of candidates) {
      try {
        // Let the shared client flush its replay hold for this session first
        // so replayed deltas cannot dispatch twice around this snapshot.
        await this.waitForReplay(sessionId);
        if (!this.isCurrent(generation)) return;
        const result = await this.request<SessionResumeResult>("session.resume", {
          session_id: sessionId,
          omit_messages: true,
          ...this.profileParams(),
        });
        if (!this.isCurrent(generation)) return;
        this.applySnapshot(result, { replaceItems: false });
        await this.refreshHistory({ merge: true }, generation);
        return;
      } catch (error) {
        if (!this.isCurrent(generation)) return;
        lastError = error;
        if (!isSessionGone(error)) break;
      }
    }
    if (!this.isCurrent(generation)) return;
    this.dispatch({ type: "session/snapshot", hydrating: false });
    if (isSessionGone(lastError)) {
      this.dispatch({
        type: "session/ended",
        reason:
          "The conversation ended while the connection was lost. Reopen it to continue.",
      });
    } else if (lastError) {
      this.dispatch({ type: "error", message: errorMessage(lastError) });
    }
  }

  /**
   * After an ambiguous `prompt.submit` timeout, ask the backend what is
   * actually true (running / inflight) instead of guessing from history text.
   */
  private async recoverLiveState(
    sessionId: string,
    token: number,
    options: { history?: boolean } = {},
  ): Promise<void> {
    try {
      const result = await this.request<SessionResumeResult>("session.resume", {
        session_id: sessionId,
        omit_messages: true,
        ...this.profileParams(),
      });
      if (!this.isCurrent(token)) return;
      this.applySnapshot(result, { replaceItems: false });
      if (options.history) await this.refreshHistory({ merge: true }, token);
    } catch {
      // Leave the local transcript alone; the next reconnect resumes it.
    }
  }

  /* ---------------------------------------------------------------- */
  /* Teardown                                                          */
  /* ---------------------------------------------------------------- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Closing the page cannot leave the agent waiting on a prompt: settle
    // every visible and retained request on the safe side (deny / cancel).
    for (const request of this.handles.values()) this.settleRequest(request);
    for (const bucket of this.retained.values()) {
      for (const request of bucket) {
        if (request.method === "approval") request.respond({ choice: "deny" });
        else if (request.method === "clarify") request.respond({});
        else request.fail(JSON_RPC_METHOD_NOT_FOUND, "the chat closed");
      }
    }
    this.retained.clear();
    this.clearReconnectTimer();
    this.clearRecoveryTimer();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    try {
      this.transport.close();
    } catch {
      // Closing a dead socket is not an error.
    }
  }
}

function coerceErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const row = payload as Record<string, unknown>;
  if (typeof row.message === "string") return row.message;
  if (typeof row.error === "string") return row.error;
  return "";
}
