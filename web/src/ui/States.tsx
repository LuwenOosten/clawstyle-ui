import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, SearchX } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Loading / empty / no-match / error states                           */
/*                                                                     */
/* One presentation for the four states list surfaces share. Actions    */
/* stay opt-in: pages pass Retry/Clear/Create only when the flow has a  */
/* real handler, so the states never advertise a dead affordance.       */
/* ------------------------------------------------------------------ */

interface StateBaseProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

function StateFrame({
  title,
  description,
  action,
  icon,
  tone,
  className,
  children,
}: StateBaseProps & { icon: ReactNode; tone?: "error" }) {
  return (
    <div
      className={cn("ui-state", tone === "error" && "ui-state--error", className)}
      role={tone === "error" ? "alert" : undefined}
    >
      <span className="ui-state__icon" aria-hidden>
        {icon}
      </span>
      <span className="ui-state__title">{title}</span>
      {description ? (
        <span className="ui-state__desc">{description}</span>
      ) : null}
      {children}
      {action ? <div className="ui-state__actions">{action}</div> : null}
    </div>
  );
}

export function LoadingState({
  title = "Loading…",
  className,
}: {
  title?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("ui-state", className)}
      aria-busy="true"
      aria-live="polite"
    >
      <Loader2 className="ui-state__icon animate-spin" aria-hidden />
      <span className="ui-state__desc">{title}</span>
    </div>
  );
}

export function EmptyState(props: StateBaseProps) {
  return <StateFrame icon={<Inbox />} {...props} />;
}

export function NoMatchState({
  title = "No matches",
  description,
  action,
  className,
}: StateBaseProps) {
  return (
    <StateFrame
      icon={<SearchX />}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

export interface ErrorStateProps extends StateBaseProps {
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Retry",
  className,
  children,
}: ErrorStateProps) {
  return (
    <StateFrame
      icon={<AlertTriangle />}
      title={title}
      description={description}
      tone="error"
      className={className}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    >
      {children}
    </StateFrame>
  );
}
