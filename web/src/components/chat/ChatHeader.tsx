import { ChevronDown, Info, Menu, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/ui";
import { cn } from "@/lib/utils";
import type { ChatConnectionState } from "@/features/chat/types";
import type { SessionLiveInfo } from "@hermes/shared";
import { useChatI18n } from "@/features/chat/useChatI18n";

const TONE: Record<ChatConnectionState, string> = {
  idle: "bg-text-tertiary",
  connecting: "bg-warning",
  open: "bg-success",
  closed: "bg-text-tertiary",
  error: "bg-destructive",
};

/**
 * Understated workspace header: conversation title, connection state, model
 * pill and the rail/details toggles. No oversized chrome.
 */
export function ChatHeader({
  title,
  info,
  modelAvailable,
  connection,
  sessionEnded,
  onOpenModel,
  onToggleDetails,
  onToggleRail,
  onNewChat,
  onReopen,
}: {
  title: string;
  info: SessionLiveInfo | null;
  /** Model switching needs a live runtime session; hide the pill otherwise. */
  modelAvailable: boolean;
  connection: ChatConnectionState;
  sessionEnded: boolean;
  onOpenModel: () => void;
  onToggleDetails: () => void;
  onToggleRail: () => void;
  onNewChat: () => void;
  onReopen: () => void;
}) {
  const copy = useChatI18n();
  const connectionLabel =
    connection === "open"
      ? copy.connectionLive
      : connection === "connecting"
        ? copy.connectionConnecting
        : connection === "error"
          ? copy.connectionError
          : copy.connectionOffline;
  const modelLabel = info?.model || copy.model;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={onToggleRail}
        aria-label={copy.railToggle}
        title={copy.railToggle}
        data-chat-action="toggle-rail"
      >
        <Menu className="h-4 w-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="min-w-0 truncate text-sm font-medium text-foreground" title={title}>
          {title}
        </h1>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-text-tertiary"
          title={connectionLabel}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", TONE[connection])} aria-hidden />
          <span className="hidden sm:inline">{connectionLabel}</span>
        </span>
      </div>

      {sessionEnded ? (
        <Button variant="secondary" size="xs" onClick={onReopen} data-chat-action="reopen">
          <RotateCcw className="h-3 w-3" />
          {copy.reopen}
        </Button>
      ) : null}

      {info && modelAvailable ? (
        <button
          type="button"
          onClick={onOpenModel}
          className="hidden max-w-[14rem] items-center gap-1 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-border hover:text-foreground sm:inline-flex"
          title={`${copy.model}: ${modelLabel}`}
          data-chat-action="model"
        >
          <span className="truncate">{modelLabel.split("/").slice(-1)[0]}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      ) : null}

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleDetails}
        aria-label={copy.details}
        title={copy.details}
        data-chat-action="details"
      >
        <Info className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onNewChat}
        aria-label={copy.newChat}
        title={copy.newChat}
        data-chat-action="new-chat"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </header>
  );
}
