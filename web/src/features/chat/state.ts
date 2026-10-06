/**
 * Pure transcript normalization + reducer for the native chat surface.
 *
 * Everything the UI renders goes through this module: gateway
 * `TranscriptMessage` rows (history / resume) and live typed events are both
 * projected into `ChatMessageItem[]`. No PTY/ANSI parsing happens anywhere.
 */
import type {
  InflightTurn,
  MessageCompletePayload,
  SessionLiveInfo,
  TranscriptMessage,
  Usage,
} from "@hermes/shared";

import type {
  ChatMessageItem,
  ChatRequestItem,
  ChatSendPhase,
  ChatState,
  ChatStatusLine,
  ChatToolItem,
} from "./types";

/* ------------------------------------------------------------------ */
/* Text coercion                                                       */
/* ------------------------------------------------------------------ */

function textFromPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const row = part as Record<string, unknown>;
  if (typeof row.text === "string") return row.text;
  if (typeof row.content === "string") return row.content;
  return "";
}

/** Coerce a gateway `content`/`text` value (string, parts array, or object). */
export function coerceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map(textFromPart)
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* History projection                                                  */
/* ------------------------------------------------------------------ */

let historyKeySeq = 0;

function historyId(role: string, index: number, rowId?: number | null): string {
  if (typeof rowId === "number" && Number.isFinite(rowId)) return `row:${rowId}`;
  historyKeySeq += 1;
  return `hist:${role}:${index}:${historyKeySeq}`;
}

function toolFromHistory(row: TranscriptMessage, index: number): ChatToolItem {
  const name = row.name || "tool";
  return {
    id: `tool:${row.tool_call_id || `${name}:${index}`}`,
    name,
    context: row.context ?? null,
    args: (row.args as Record<string, unknown> | null | undefined) ?? null,
    argsText: null,
    preview: null,
    labels: row.labels ?? null,
    status: "complete",
    summary: null,
    // Only edit-like tools ship `content` in the compact display projection;
    // other persisted tool results are intentionally omitted by the backend.
    resultText: coerceText(row.content) || null,
    inlineDiff: null,
    durationS: null,
  };
}

/** Project persisted transcript rows into renderable items. */
export function historyToItems(messages: TranscriptMessage[]): ChatMessageItem[] {
  const items: ChatMessageItem[] = [];
  messages.forEach((row, index) => {
    const role = typeof row.role === "string" ? row.role : "";
    if (role === "tool") {
      items.push({
        id: historyId("tool", index, null),
        kind: "tool",
        text: "",
        tool: toolFromHistory(row, index),
        timestamp: row.timestamp ?? null,
        rowId: null,
      });
      return;
    }
    const text = coerceText(row.text) || coerceText(row.content);
    const reasoning = typeof row.reasoning === "string" ? row.reasoning : undefined;
    if (!text.trim() && !reasoning?.trim()) return;
    if (role === "system") {
      if (text.trim()) {
        items.push({
          id: historyId("system", index, row.row_id),
          kind: "notice",
          text,
          timestamp: row.timestamp ?? null,
          rowId: row.row_id ?? null,
        });
      }
      return;
    }
    const kind = role === "user" ? "user" : "assistant";
    items.push({
      id: historyId(kind, index, row.row_id),
      kind,
      text,
      ...(reasoning ? { reasoning } : {}),
      timestamp: row.timestamp ?? null,
      rowId: row.row_id ?? null,
    });
  });
  return items;
}

function textEquivalent(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.endsWith(right) || right.endsWith(left);
}

function sameTool(a: ChatToolItem, b: ChatToolItem): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  if (a.name !== b.name) return false;
  const left = a.argsText ?? JSON.stringify(a.args ?? {});
  const right = b.argsText ?? JSON.stringify(b.args ?? {});
  return left === right;
}

/**
 * Merge persisted rows into an existing live transcript, preserving order.
 *
 * Live items are richer (tool summaries/results, streamed text) than the
 * compact persisted projection, so history is used to backfill missing rows
 * and to stamp durable `rowId`s onto items already on screen.
 *
 * Matching rules keep real duplicates apart:
 * - a candidate with a `rowId` only matches the same `rowId`, or a live item
 *   that has no durable id yet (same kind, equivalent text/tool identity);
 * - two different durable row ids never collapse, even with equal text.
 * Unmatched current items stay where they are; missing durable rows are
 * inserted at the position the incoming order implies.
 */
export function mergeHistoryItems(
  current: ChatMessageItem[],
  incoming: ChatMessageItem[],
): ChatMessageItem[] {
  const used = new Set<number>();
  const result: ChatMessageItem[] = [];
  let cursor = 0;

  const appendCurrentUpTo = (limit: number) => {
    while (cursor < limit) {
      if (!used.has(cursor)) result.push(current[cursor]);
      cursor += 1;
    }
  };

  const matches = (item: ChatMessageItem, candidate: ChatMessageItem): boolean => {
    if (used.size >= current.length) return false;
    if (item.kind !== candidate.kind) return false;
    if (candidate.rowId != null) {
      if (item.rowId != null) return item.rowId === candidate.rowId;
      // A durable row may claim a live (unstamped) item, never another row.
      return candidate.kind === "tool"
        ? Boolean(item.tool && candidate.tool && sameTool(item.tool, candidate.tool))
        : textEquivalent(item.text, candidate.text);
    }
    return candidate.kind === "tool"
      ? Boolean(item.tool && candidate.tool && sameTool(item.tool, candidate.tool))
      : textEquivalent(item.text, candidate.text);
  };

  const findMatch = (candidate: ChatMessageItem): number => {
    for (let index = cursor; index < current.length; index += 1) {
      if (used.has(index)) continue;
      if (matches(current[index], candidate)) return index;
    }
    return -1;
  };

  for (const candidate of incoming) {
    if (candidate.kind === "notice") continue;
    const match = findMatch(candidate);
    if (match < 0) {
      if (candidate.rowId == null) {
        appendCurrentUpTo(current.length);
        result.push(candidate);
        continue;
      }
      // Missing durable row: order it by row id against the current items so
      // an older backfilled row lands before a later existing one.
      const beforeIndex = current.findIndex(
        (item, index) =>
          index >= cursor &&
          !used.has(index) &&
          item.rowId != null &&
          item.rowId > (candidate.rowId as number),
      );
      if (beforeIndex < 0) {
        appendCurrentUpTo(current.length);
        result.push(candidate);
        cursor = current.length;
      } else {
        appendCurrentUpTo(beforeIndex);
        result.push(candidate);
      }
      continue;
    }
    appendCurrentUpTo(match);
    used.add(match);
    const existing = current[match];
    result.push({
      ...existing,
      rowId: candidate.rowId ?? existing.rowId,
      timestamp: existing.timestamp ?? candidate.timestamp,
    });
    cursor = match + 1;
  }

  appendCurrentUpTo(current.length);
  return result;
}

/* ------------------------------------------------------------------ */
/* Inflight overlay                                                    */
/* ------------------------------------------------------------------ */

function applyInflight(
  state: ChatState,
  inflight: InflightTurn | null | undefined,
): ChatState {
  if (!inflight) return state;
  const items = [...state.items];
  const user = inflight.user?.trim() ?? "";
  if (user) {
    const lastUser = [...items].reverse().find((item) => item.kind === "user");
    if (!lastUser || !textEquivalent(lastUser.text, user)) {
      items.push({
        id: `inflight-user:${state.turnToken}:${state.segmentSeq}`,
        kind: "user",
        text: user,
        timestamp: null,
      });
    }
  }
  const assistant = inflight.assistant ?? "";
  let openAssistantId = state.openAssistantId;
  let turnHasAssistant = state.turnHasAssistant;
  if (assistant.trim()) {
    const lastAssistant = [...items].reverse().find((item) => item.kind === "assistant");
    if (!lastAssistant || !textEquivalent(lastAssistant.text, assistant)) {
      const id = `inflight-assistant:${state.turnToken}:${state.segmentSeq}`;
      items.push({
        id,
        kind: "assistant",
        text: assistant,
        streaming: inflight.streaming !== false,
      });
      openAssistantId = id;
      turnHasAssistant = true;
    } else {
      const index = items.indexOf(lastAssistant);
      if (inflight.streaming) {
        items[index] = { ...lastAssistant, streaming: true };
      }
      openAssistantId = lastAssistant.id;
      turnHasAssistant = true;
    }
  }
  return {
    ...state,
    items,
    openAssistantId,
    turnHasAssistant,
    running: inflight.streaming !== false || state.running,
  };
}

/* ------------------------------------------------------------------ */
/* Initial state + reducer                                             */
/* ------------------------------------------------------------------ */

export function createInitialChatState(profile = ""): ChatState {
  return {
    profile,
    storedSessionId: null,
    runtimeSessionId: null,
    info: null,
    items: [],
    running: false,
    queued: null,
    hydrating: false,
    sessionEnded: false,
    error: null,
    sendPhase: "idle",
    requests: [],
    status: null,
    usage: null,
    turnVersion: 0,
    openAssistantId: null,
    segmentSeq: 0,
    turnToken: 0,
    turnHasAssistant: false,
  };
}

export type ChatAction =
  | {
      type: "scope/reset";
      profile: string;
      storedSessionId?: string | null;
    }
  | { type: "session/linked"; storedSessionId: string; runtimeSessionId: string }
  | {
      type: "session/snapshot";
      storedSessionId?: string | null;
      runtimeSessionId?: string | null;
      info?: SessionLiveInfo | null;
      messages?: TranscriptMessage[];
      inflight?: InflightTurn | null;
      running?: boolean;
      queued?: string | null;
      hydrating?: boolean;
      replaceItems?: boolean;
    }
  | { type: "history/replace"; messages: TranscriptMessage[] }
  | { type: "history/merge"; messages: TranscriptMessage[] }
  | { type: "user/append"; id: string; text: string; timestamp?: number | null }
  | { type: "user/remove"; id: string }
  | { type: "turn/start" }
  | { type: "assistant/delta"; text: string }
  | { type: "assistant/interim"; text: string }
  | { type: "reasoning/delta"; text: string }
  | { type: "tool/start"; tool: ChatToolItem }
  | { type: "tool/complete"; toolId: string; patch: Partial<ChatToolItem> }
  | { type: "turn/complete"; payload: MessageCompletePayload }
  | { type: "session/info"; info: SessionLiveInfo }
  | { type: "session/title"; title: string }
  | { type: "session/usage"; usage: Usage }
  | { type: "session/queued"; text: string | null }
  | { type: "session/ended"; reason?: string }
  | { type: "send/phase"; phase: ChatSendPhase }
  | { type: "request/add"; request: ChatRequestItem }
  | { type: "request/remove"; id: string }
  | { type: "notice/append"; id: string; text: string; tone?: "info" | "error" }
  | { type: "status"; status: ChatStatusLine | null }
  | { type: "error"; message: string | null };

function sealOpenAssistant(state: ChatState): ChatState {
  if (!state.openAssistantId) return state;
  const index = state.items.findIndex((item) => item.id === state.openAssistantId);
  if (index < 0) return { ...state, openAssistantId: null };
  const items = [...state.items];
  if (items[index].streaming) {
    items[index] = { ...items[index], streaming: false };
  }
  return { ...state, items, openAssistantId: null };
}

function openAssistant(state: ChatState): {
  state: ChatState;
  index: number;
} {
  if (state.openAssistantId) {
    const index = state.items.findIndex((item) => item.id === state.openAssistantId);
    if (index >= 0) return { state, index };
  }
  const id = `live:${state.turnToken}:${state.segmentSeq}`;
  const items = [
    ...state.items,
    {
      id,
      kind: "assistant" as const,
      text: "",
      streaming: true,
    },
  ];
  return {
    state: {
      ...state,
      items,
      openAssistantId: id,
      turnHasAssistant: true,
      segmentSeq: state.segmentSeq + 1,
    },
    index: items.length - 1,
  };
}

function mergeFinalText(previous: string, finalText: string): string {
  if (!finalText) return previous;
  if (!previous) return finalText;
  if (previous === finalText) return previous;
  if (finalText.endsWith(previous) || finalText.includes(previous)) return finalText;
  if (previous.includes(finalText)) return previous;
  return finalText;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "scope/reset":
      return {
        ...createInitialChatState(action.profile),
        storedSessionId: action.storedSessionId ?? null,
      };

    case "session/linked":
      return {
        ...state,
        storedSessionId: action.storedSessionId,
        runtimeSessionId: action.runtimeSessionId,
        sessionEnded: false,
      };

    case "session/snapshot": {
      let next: ChatState = {
        ...state,
        storedSessionId: action.storedSessionId ?? state.storedSessionId,
        runtimeSessionId: action.runtimeSessionId ?? state.runtimeSessionId,
        info: action.info ?? state.info,
        queued: action.queued ?? null,
        hydrating: action.hydrating ?? false,
        sessionEnded: false,
        error: null,
      };
      if (action.messages) {
        const history = historyToItems(action.messages);
        next = {
          ...next,
          items: action.replaceItems
            ? [
                ...history,
                ...next.items.filter(
                  (item) => item.kind === "notice" || item.kind === "error",
                ),
              ]
            : mergeHistoryItems(next.items, history),
        };
      }
      next = applyInflight(next, action.inflight);
      if (action.replaceItems && !action.inflight) {
        next = { ...next, openAssistantId: null };
      }
      if (typeof action.running === "boolean") {
        next = { ...next, running: action.running };
      }
      return next;
    }

    case "history/replace":
      return {
        ...state,
        items: historyToItems(action.messages),
        openAssistantId: null,
        turnHasAssistant: false,
        hydrating: false,
      };

    case "history/merge":
      return {
        ...state,
        items: mergeHistoryItems(state.items, historyToItems(action.messages)),
      };

    case "user/append": {
      if (state.items.some((item) => item.id === action.id)) return state;
      return {
        ...state,
        // A new user turn begins: the next completion must not rewrite the
        // previous answer when no delta streamed for this turn.
        turnHasAssistant: false,
        openAssistantId: null,
        items: [
          ...state.items,
          {
            id: action.id,
            kind: "user",
            text: action.text,
            timestamp: action.timestamp ?? null,
          },
        ],
      };
    }

    case "user/remove":
      return {
        ...state,
        items: state.items.filter((item) => item.id !== action.id),
      };

    case "turn/start":
      return { ...state, running: true, error: null };

    case "assistant/delta": {
      const opened = openAssistant(state);
      const items = [...opened.state.items];
      const current = items[opened.index];
      items[opened.index] = {
        ...current,
        text: current.text + action.text,
        streaming: true,
      };
      return { ...opened.state, items, running: true };
    }

    case "assistant/interim": {
      const sealed = sealOpenAssistant(state);
      return {
        ...sealed,
        items: [
          ...sealed.items,
          {
            id: `live:${sealed.turnToken}:${sealed.segmentSeq}`,
            kind: "assistant",
            text: action.text,
            streaming: false,
          },
        ],
        segmentSeq: sealed.segmentSeq + 1,
        running: true,
      };
    }

    case "reasoning/delta": {
      const opened = openAssistant(state);
      const items = [...opened.state.items];
      const current = items[opened.index];
      items[opened.index] = {
        ...current,
        reasoning: (current.reasoning ?? "") + action.text,
      };
      return { ...opened.state, items, running: true };
    }

    case "tool/start": {
      const sealed = sealOpenAssistant(state);
      const existing = sealed.items.findIndex(
        (item) => item.kind === "tool" && item.tool?.id === action.tool.id,
      );
      const items = [...sealed.items];
      if (existing >= 0) {
        items[existing] = { ...items[existing], tool: action.tool };
      } else {
        items.push({
          id: `tool:${action.tool.id}`,
          kind: "tool",
          text: "",
          tool: action.tool,
        });
      }
      return { ...sealed, items, running: true };
    }

    case "tool/complete": {
      const index = state.items.findIndex(
        (item) => item.kind === "tool" && item.tool?.id === action.toolId,
      );
      if (index < 0) {
        // Completion without a start (reconnect replay): render it complete.
        return {
          ...state,
          items: [
            ...state.items,
            {
              id: `tool:${action.toolId}`,
              kind: "tool",
              text: "",
              tool: {
                id: action.toolId,
                name: action.patch.name ?? "tool",
                status: "complete",
                ...action.patch,
              },
            },
          ],
        };
      }
      const items = [...state.items];
      const tool = items[index].tool as ChatToolItem;
      items[index] = {
        ...items[index],
        tool: { ...tool, ...action.patch, status: "complete" },
      };
      return { ...state, items };
    }

    case "turn/complete": {
      const sealed = sealOpenAssistant(state);
      const payload = action.payload;
      const finalText = coerceText(payload.text) || coerceText(payload.rendered);
      const failed = payload.status === "error";
      const items = [...sealed.items];
      let lastAssistant = -1;
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (items[i].kind === "assistant") {
          lastAssistant = i;
          break;
        }
      }
      // Only the CURRENT turn's assistant bubble may be finalized in place.
      // Without streamed deltas the final text is a new answer and must not
      // overwrite the previous turn's reply.
      const belongsToTurn = sealed.turnHasAssistant && lastAssistant >= 0;
      if (finalText) {
        if (belongsToTurn) {
          const current = items[lastAssistant];
          items[lastAssistant] = {
            ...current,
            text: mergeFinalText(current.text, finalText),
            streaming: false,
            failed,
            turnStatus: payload.status ?? "complete",
          };
        } else {
          items.push({
            id: `live:${sealed.turnToken}:${sealed.segmentSeq}`,
            kind: "assistant",
            text: finalText,
            streaming: false,
            failed,
            turnStatus: payload.status ?? "complete",
          });
        }
      } else if (belongsToTurn) {
        items[lastAssistant] = {
          ...items[lastAssistant],
          streaming: false,
          failed,
          turnStatus: payload.status ?? "complete",
        };
      }
      // Drop an empty assistant bubble created by message.start only.
      const pruned = items.filter(
        (item) =>
          !(
            item.kind === "assistant" &&
            !item.text.trim() &&
            !item.reasoning?.trim() &&
            !item.failed
          ),
      );
      const errorText =
        failed && payload.error
          ? coerceText(payload.error) || finalText || "The turn failed."
          : null;
      return {
        ...sealed,
        items: pruned,
        running: false,
        queued: null,
        sendPhase: "idle",
        status: null,
        usage: payload.usage ?? sealed.usage,
        error: errorText,
        turnVersion: sealed.turnVersion + 1,
        turnHasAssistant: false,
        openAssistantId: null,
      };
    }

    case "session/info":
      return { ...state, info: { ...(state.info ?? {}), ...action.info } };

    case "session/title":
      return {
        ...state,
        info: { ...(state.info ?? {}), title: action.title },
      };

    case "session/usage":
      return { ...state, usage: action.usage };

    case "session/queued":
      return { ...state, queued: action.text };

    case "session/ended":
      return {
        ...state,
        sessionEnded: true,
        running: false,
        sendPhase: "idle",
        runtimeSessionId: null,
        items: [
          ...sealOpenAssistant(state).items,
          {
            id: `notice:ended:${state.turnVersion}:${state.segmentSeq}`,
            kind: "notice",
            text: action.reason ?? "This session ended.",
          },
        ],
      };

    case "send/phase":
      return { ...state, sendPhase: action.phase };

    case "request/add": {
      if (state.requests.some((item) => item.id === action.request.id)) return state;
      return { ...state, requests: [...state.requests, action.request] };
    }

    case "request/remove":
      return {
        ...state,
        requests: state.requests.filter((item) => item.id !== action.id),
      };

    case "notice/append":
      return {
        ...state,
        items: [
          ...state.items,
          {
            id: action.id,
            kind: action.tone === "error" ? "error" : "notice",
            text: action.text,
          },
        ],
      };

    case "status":
      return { ...state, status: action.status };

    case "error":
      return { ...state, error: action.message };

    default:
      return state;
  }
}
