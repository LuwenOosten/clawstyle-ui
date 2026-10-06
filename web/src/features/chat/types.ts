/**
 * Native chat domain types.
 *
 * These describe the browser-side projection of the Hermes `tui_gateway`
 * structured chat surface (`/api/ws`): a real conversation rendered from
 * typed JSON-RPC events, never from PTY/ANSI output.
 */
import type {
  ApprovalRequestParams,
  ClarifyRequestParams,
  SessionLiveInfo,
  ToolLabel,
  Usage,
} from "@hermes/shared";

export type ChatConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type ChatItemKind = "user" | "assistant" | "tool" | "notice" | "error";

export interface ChatToolItem {
  id: string;
  name: string;
  /** Short server-rendered call context ("read file.ts"). */
  context?: string | null;
  args?: Record<string, unknown> | null;
  argsText?: string | null;
  preview?: string | null;
  labels?: ToolLabel[] | null;
  status: "running" | "complete";
  summary?: string | null;
  resultText?: string | null;
  inlineDiff?: string | null;
  durationS?: number | null;
}

export interface ChatMessageItem {
  /** Stable React key within one transcript. */
  id: string;
  kind: ChatItemKind;
  text: string;
  reasoning?: string;
  tool?: ChatToolItem;
  timestamp?: number | null;
  rowId?: number | null;
  streaming?: boolean;
  /** The turn carrying this item finished with an error. */
  failed?: boolean;
  turnStatus?: "complete" | "error" | "interrupted" | null;
  usage?: Usage | null;
}

export type ChatSendPhase = "idle" | "creating" | "submitting" | "stopping";

export interface ChatApprovalRequest {
  id: string;
  method: "approval";
  params: ApprovalRequestParams;
}

export interface ChatClarifyRequest {
  id: string;
  method: "clarify";
  params: ClarifyRequestParams;
}

export type ChatRequestItem = ChatApprovalRequest | ChatClarifyRequest;

export interface ChatStatusLine {
  kind: string;
  text: string;
}

export interface ChatState {
  profile: string;
  storedSessionId: string | null;
  runtimeSessionId: string | null;
  info: SessionLiveInfo | null;
  items: ChatMessageItem[];
  running: boolean;
  queued: string | null;
  hydrating: boolean;
  /** The live session was reclaimed/reaped and must be resumed again. */
  sessionEnded: boolean;
  error: string | null;
  sendPhase: ChatSendPhase;
  requests: ChatRequestItem[];
  status: ChatStatusLine | null;
  usage: Usage | null;
  /** Incremented on every completed/aborted turn (scroll + reconciliation). */
  turnVersion: number;
  /** Internal: the open streaming assistant segment, if any. */
  openAssistantId: string | null;
  /** Internal: monotonically increasing segment counter. */
  segmentSeq: number;
  /** Internal: monotonically increasing turn counter. */
  turnToken: number;
  /** Internal: the current turn already produced an assistant segment. */
  turnHasAssistant: boolean;
}

export interface ChatCreateResult {
  session_id: string;
  stored_session_id: string;
}

export interface ChatModelSelection {
  model: string;
  provider: string;
}
