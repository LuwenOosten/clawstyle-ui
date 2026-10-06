import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { StatusResponse } from "@/lib/api";
import { errorMessage } from "@/lib/api-error";

const POLL_MS = 10_000;

export interface SidebarStatusResult {
  /** Latest successfully fetched status, or null when none has arrived yet. */
  status: StatusResponse | null;
  /** True after a poll failed and no later poll has succeeded. */
  unreachable: boolean;
  /** Last failure sentence, for the backend diagnostic banner. */
  error: string | null;
  /** Force an immediate re-poll (used by the banner's Retry action). */
  retry: () => void;
}

/**
 * Light-weight status poll for the app shell (sidebar). The Status page uses
 * its own faster interval; we keep this slower to avoid duplicate load.
 *
 * A failed poll used to be swallowed, leaving the sidebar shimmering forever
 * with no signal that the backend was down. It now records the failure so the
 * shell can render an actionable backend-unavailable banner and retry on
 * demand.
 */
export function useSidebarStatus(): SidebarStatusResult {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .getStatus()
        .then((next) => {
          if (cancelled) return;
          setStatus(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(errorMessage(cause));
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { error, retry, status, unreachable: error !== null };
}
