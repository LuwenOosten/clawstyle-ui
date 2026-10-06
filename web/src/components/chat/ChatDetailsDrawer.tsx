import { X } from "lucide-react";

import { Button } from "@/ui";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import type { ChatToolItem } from "@/features/chat/types";
import type { SessionLiveInfo, Usage } from "@hermes/shared";
import { useChatI18n } from "@/features/chat/useChatI18n";

function usageLine(usage: Usage | null): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (typeof usage.input === "number") parts.push(`in ${usage.input}`);
  if (typeof usage.output === "number") parts.push(`out ${usage.output}`);
  if (typeof usage.total === "number") parts.push(`total ${usage.total}`);
  return parts.join(" · ");
}

/**
 * Right-hand details drawer, closed by default. Shows session metadata or one
 * tool call's full payload (never inline in the transcript).
 */
export function ChatDetailsDrawer({
  open,
  tool,
  info,
  storedSessionId,
  usage,
  onClose,
}: {
  open: boolean;
  tool: ChatToolItem | null;
  info: SessionLiveInfo | null;
  storedSessionId: string | null;
  usage: Usage | null;
  onClose: () => void;
}) {
  const copy = useChatI18n();
  const ref = useModalBehavior({ open, onClose });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" data-testid="chat-details">
      <button
        type="button"
        aria-label={copy.close}
        onClick={onClose}
        className="absolute inset-0 bg-background/70"
      />
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={copy.details}
        className="relative flex h-full w-full max-w-sm flex-col border-l border-border bg-card shadow-2xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {tool ? copy.detailsTool : copy.detailsSession}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={copy.close}
            title={copy.close}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-text-secondary">
          {tool ? (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
                  {copy.detailsTool}
                </div>
                <div className="font-mono text-foreground">{tool.name}</div>
                {tool.context ? (
                  <div className="mt-0.5">{tool.context}</div>
                ) : null}
              </div>
              {tool.args ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
                    {copy.args}
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 px-2 py-1.5 text-[11px]">
                    {JSON.stringify(tool.args, null, 2)}
                  </pre>
                </div>
              ) : null}
              {tool.summary ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
                    {copy.result}
                  </div>
                  <p>{tool.summary}</p>
                </div>
              ) : null}
              {tool.resultText ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
                    {copy.result}
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 px-2 py-1.5 text-[11px]">
                    {tool.resultText}
                  </pre>
                </div>
              ) : null}
              {tool.inlineDiff ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
                    {copy.diff}
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 px-2 py-1.5 text-[11px]">
                    {tool.inlineDiff}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : !storedSessionId && !info ? (
            <p>{copy.noDetails}</p>
          ) : (
            <dl className="space-y-2">
              {info?.title ? (
                <Detail label={copy.detailsSession} value={info.title} />
              ) : null}
              {storedSessionId ? (
                <Detail label={copy.sessionId} value={storedSessionId} mono />
              ) : null}
              {info?.model ? <Detail label={copy.model} value={info.model} /> : null}
              {info?.provider ? (
                <Detail label="Provider" value={info.provider} />
              ) : null}
              {info?.cwd ? <Detail label={copy.cwd} value={info.cwd} mono /> : null}
              {typeof info?.running === "boolean" ? (
                <Detail
                  label={copy.status}
                  value={info.running ? "running" : "idle"}
                />
              ) : null}
              {usageLine(usage) ? (
                <Detail label={copy.usage} value={usageLine(usage)} />
              ) : null}
            </dl>
          )}
        </div>
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className={mono ? "break-all font-mono text-foreground" : "break-words text-foreground"}>
        {value}
      </dd>
    </div>
  );
}
