import { AlertTriangle, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";

/**
 * App-shell banner shown once the sidebar status poll has failed. Without it a
 * stopped backend looked like a page that was still loading (the status strip
 * stayed on its shimmer forever), so the operator had no way to tell that
 * `hermes dashboard` was down versus the UI being slow.
 *
 * `detail` is the raw error sentence (English technical copy) shown dimmed so a
 * bug report can quote it; the translated copy above it explains how to fix it.
 */
export function BackendUnavailableBanner({
  detail,
  onRetry,
  unreachable,
}: {
  detail?: string | null;
  onRetry: () => void;
  unreachable: boolean;
}) {
  const { t } = useI18n();
  if (!unreachable) return null;

  const title = t.app.backendUnavailableTitle ?? "Cannot reach the Hermes Agent backend.";
  const body =
    t.app.backendUnavailableBody ??
    "Start it (`hermes dashboard`, default http://127.0.0.1:9119). If this UI is served by its standalone server, check that HERMES_DASHBOARD_URL points at the backend and that the backend listens on loopback.";
  const retryLabel = t.app.backendUnavailableRetry ?? "Retry now";

  return (
    <div
      role="alert"
      data-testid="backend-unavailable-banner"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{title}</span> <span className="opacity-90">{body}</span>
        {detail ? (
          <span className="block truncate text-destructive/70" title={detail}>
            {detail}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-destructive/40 px-2 py-0.5 font-medium hover:bg-destructive/10"
      >
        <RefreshCw className="h-3 w-3" aria-hidden />
        {retryLabel}
      </button>
    </div>
  );
}
