import { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import type { ApprovalChoice } from "@hermes/shared";

import { Button } from "@/ui";
import { cn } from "@/lib/utils";
import type { ChatApprovalRequest } from "@/features/chat/types";
import { useChatI18n } from "@/features/chat/useChatI18n";

/**
 * Human approval for a dangerous command. Every action is an explicit click;
 * the card takes focus as a container (not a button) so Enter cannot
 * accidentally approve. Deny is always available.
 */
export function ChatApprovalCard({
  request,
  onRespond,
}: {
  request: ChatApprovalRequest;
  onRespond: (choice: ApprovalChoice, options?: { all?: boolean }) => void;
}) {
  const copy = useChatI18n();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const params = request.params;
  const choices = params.choices ?? [];
  const canOnce = choices.length === 0 || choices.includes("once");
  const canSession = choices.includes("session") && params.allow_session !== false;
  const canAlways = choices.includes("always") && params.allow_permanent !== false;

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="alertdialog"
      aria-label={copy.approvalTitle}
      data-chat-request="approval"
      data-request-id={request.id}
      className={cn(
        "mx-auto w-full max-w-[46rem] rounded-xl border border-warning/60 bg-warning/5 p-3 shadow-sm",
        "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning/70",
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{copy.approvalTitle}</p>
          {params.tool_name ? (
            <p className="mt-0.5 text-xs text-text-secondary">
              {copy.approvalTool}: <span className="font-mono">{params.tool_name}</span>
            </p>
          ) : null}
          {params.description ? (
            <p className="mt-1 text-xs text-text-secondary">{params.description}</p>
          ) : null}
        </div>
      </div>

      {params.command ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
          {params.command}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="danger"
          size="sm"
          onClick={() => onRespond("deny")}
          data-chat-approval="deny"
        >
          {copy.deny}
        </Button>
        {canOnce ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => onRespond("once")}
            data-chat-approval="once"
          >
            {copy.allowOnce}
          </Button>
        ) : null}
        {canSession ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRespond("session")}
            data-chat-approval="session"
          >
            {copy.allowSession}
          </Button>
        ) : null}
        {canAlways ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRespond("always")}
            data-chat-approval="always"
          >
            {copy.allowAlways}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
