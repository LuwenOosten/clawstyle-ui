import { useMemo } from "react";

import { Markdown } from "@/components/Markdown";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { ChatCopyButton } from "@/components/chat/ChatCopyButton";
import type { ChatMessageItem } from "@/features/chat/types";
import { useChatI18n } from "@/features/chat/useChatI18n";

function formatTimestamp(timestamp: number | null | undefined): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  try {
    return new Date(timestamp * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * One transcript row. User turns are a restrained bubble; assistant turns are
 * open prose so long answers stay readable. Tool calls and notices are
 * rendered by their own components.
 */
export function ChatMessageView({ item }: { item: ChatMessageItem }) {
  const copy = useChatI18n();
  const timestamp = useMemo(() => formatTimestamp(item.timestamp), [item.timestamp]);

  if (item.kind === "notice") {
    return (
      <div
        className="mx-auto my-2 max-w-[46rem] px-2 text-center text-xs text-text-tertiary"
        data-chat-item="notice"
      >
        {item.text}
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div
        role="alert"
        className="mx-auto my-2 max-w-[46rem] rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        data-chat-item="error"
      >
        {item.text}
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="group flex justify-end" data-chat-item="user">
        <div className="flex max-w-[min(85%,42rem)] flex-col items-end gap-1">
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-border/80 bg-secondary/60 px-4 py-2.5 text-[0.9375rem] leading-relaxed text-foreground">
            {item.text}
          </div>
          <div className="flex items-center gap-2 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {timestamp ? (
              <span className="text-[10px] text-text-tertiary">{timestamp}</span>
            ) : null}
            <ChatCopyButton
              text={item.text}
              label={copy.copy}
              copiedLabel={copy.copied}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group" data-chat-item="assistant">
      {item.reasoning?.trim() ? (
        <details className="mb-2 rounded-lg border border-border/70 bg-card/50">
          <summary className="cursor-pointer list-none px-3 py-1.5 text-[11px] font-medium tracking-wide text-text-tertiary hover:text-text-secondary">
            {copy.reasoning}
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border/60 px-3 py-2 text-xs leading-relaxed text-text-secondary">
            {item.reasoning}
          </pre>
        </details>
      ) : null}
      <div
        className={cn(
          "break-words text-[0.9375rem] leading-relaxed text-foreground",
          item.failed && "text-destructive",
        )}
      >
        <Markdown
          content={item.text}
          streaming={item.streaming}
          onCopyCode={(code) => copyTextToClipboard(code)}
          copyCodeLabel={copy.copyCode}
          copiedCodeLabel={copy.copied}
        />
      </div>
      {item.failed && item.turnStatus === "error" ? (
        <p className="mt-1 text-xs text-destructive">{copy.turnFailed}</p>
      ) : null}
      <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {timestamp ? (
          <span className="text-[10px] text-text-tertiary">{timestamp}</span>
        ) : null}
        <ChatCopyButton text={item.text} label={copy.copy} copiedLabel={copy.copied} />
      </div>
    </div>
  );
}
