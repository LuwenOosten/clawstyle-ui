import { ErrorState } from "@/ui";
import { useI18n } from "@/i18n";
import { loadErrorCopy } from "@/lib/load-error-copy";
import { cn } from "@/lib/utils";

interface LoadErrorNoticeProps {
  /** What failed to load, already translated (e.g. `t.cron.loadWhat`). */
  what: string;
  /** The humanized error (`errorMessage(err)`), shown as a dimmed detail line. */
  detail?: string | null;
  onRetry: () => void;
  className?: string;
}

/**
 * Persistent "could not load X" surface with a Retry action, rendered through
 * the shared error state so every page's load failure looks and behaves the
 * same (visible outline, retry, detail line).
 */
export function LoadErrorNotice({ what, detail, onRetry, className }: LoadErrorNoticeProps) {
  const { t } = useI18n();
  const copy = loadErrorCopy(t.common, what, detail);

  return (
    <div className={cn("ui-surface", className)}>
      <ErrorState
        title={copy.title}
        description={copy.details}
        onRetry={onRetry}
        retryLabel={t.common.retry}
      />
    </div>
  );
}
