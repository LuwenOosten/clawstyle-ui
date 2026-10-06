import { Check, Loader2, Maximize2, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ChatToolItem } from "@/features/chat/types";
import { useChatI18n } from "@/features/chat/useChatI18n";

function prettyArgs(tool: ChatToolItem): string {
  if (tool.argsText) return tool.argsText;
  if (!tool.args || Object.keys(tool.args).length === 0) return "";
  try {
    return JSON.stringify(tool.args, null, 2);
  } catch {
    return "";
  }
}

/**
 * One tool call, collapsed to a single quiet row and expandable to its
 * arguments/result. Raw tool payloads never spill into the transcript as a
 * wall of text.
 */
export function ChatToolCard({
  tool,
  onOpenDetails,
}: {
  tool: ChatToolItem;
  onOpenDetails?: (tool: ChatToolItem) => void;
}) {
  const copy = useChatI18n();
  const args = prettyArgs(tool);
  const hasBody = Boolean(args || tool.summary || tool.resultText || tool.inlineDiff || tool.labels?.length);
  const statusLabel = tool.status === "running" ? copy.toolRunning : copy.toolComplete;

  return (
    <div
      className="mx-auto w-full max-w-[46rem] rounded-lg border border-border/70 bg-card/40"
      data-chat-item="tool"
      data-tool-name={tool.name}
    >
      <details className="group">
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-2 px-3 py-2",
            "text-xs text-text-secondary transition-colors hover:text-foreground",
            "[&::-webkit-details-marker]:hidden",
          )}
        >
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/80",
              tool.status === "running" && "text-primary",
            )}
            aria-hidden
          >
            {tool.status === "running" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
          </span>
          <Wrench className="h-3 w-3 shrink-0 text-text-tertiary" aria-hidden />
          <span className="shrink-0 font-medium text-foreground">
            {tool.name || copy.toolFallback}
          </span>
          {tool.context ? (
            <span className="min-w-0 flex-1 truncate text-text-tertiary">{tool.context}</span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <span className="sr-only">{statusLabel}</span>
          {typeof tool.durationS === "number" && tool.durationS > 0 ? (
            <span className="shrink-0 text-[10px] tabular-nums text-text-tertiary">
              {tool.durationS.toFixed(1)}s
            </span>
          ) : null}
        </summary>
        {hasBody ? (
          <div className="space-y-2 border-t border-border/60 px-3 py-2">
            {tool.labels?.length ? (
              <div className="flex flex-wrap gap-1">
                {tool.labels.map((label, index) => (
                  <span
                    key={`${label.name}:${index}`}
                    className="rounded border border-border/70 bg-secondary/50 px-1.5 py-0.5 text-[10px] text-text-secondary"
                  >
                    {label.text || label.name}
                  </span>
                ))}
              </div>
            ) : null}
            {args ? (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  {copy.args}
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
                  {args}
                </pre>
              </div>
            ) : null}
            {tool.summary ? (
              <p className="text-xs text-text-secondary">{tool.summary}</p>
            ) : null}
            {tool.resultText ? (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  {copy.result}
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
                  {tool.resultText}
                </pre>
              </div>
            ) : null}
            {tool.inlineDiff ? (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  {copy.diff}
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
                  {tool.inlineDiff}
                </pre>
              </div>
            ) : null}
            {onOpenDetails ? (
              <button
                type="button"
                onClick={() => onOpenDetails(tool)}
                className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-foreground"
              >
                <Maximize2 className="h-3 w-3" aria-hidden />
                {copy.showDetails}
              </button>
            ) : null}
          </div>
        ) : null}
      </details>
    </div>
  );
}
