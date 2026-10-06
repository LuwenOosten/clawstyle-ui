/**
 * Per-profile, per-session composer drafts.
 *
 * The native chat keeps a draft while the user switches conversations; the
 * key includes the management profile so two profiles can never bleed input
 * into each other. Scope `"new"` holds the draft for an unsaved conversation.
 */
const DRAFT_PREFIX = "hermes-chat-draft:";
const LAST_SESSION_PREFIX = "hermes-chat-last-session:";
const MAX_DRAFT_CHARS = 200_000;
const NEW_SCOPE = "new";

function draftKey(profile: string | undefined, scope: string): string {
  return `${DRAFT_PREFIX}${profile ?? ""}:${scope || NEW_SCOPE}`;
}

export function readDraft(profile: string | undefined, scope: string): string {
  try {
    const value = localStorage.getItem(draftKey(profile, scope));
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function writeDraft(
  profile: string | undefined,
  scope: string,
  text: string,
): void {
  try {
    const key = draftKey(profile, scope);
    if (!text) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, text.slice(0, MAX_DRAFT_CHARS));
  } catch {
    // Storage unavailable (private mode / quota): the in-memory draft still
    // works for this page.
  }
}

export function clearDraft(profile: string | undefined, scope: string): void {
  writeDraft(profile, scope, "");
}

/* ------------------------------------------------------------------ */
/* Last selected session per profile                                   */
/* ------------------------------------------------------------------ */

export function readLastSessionId(profile: string | undefined): string | null {
  try {
    const value = localStorage.getItem(`${LAST_SESSION_PREFIX}${profile ?? ""}`);
    return value || null;
  } catch {
    return null;
  }
}

export function writeLastSessionId(
  profile: string | undefined,
  sessionId: string | null,
): void {
  try {
    const key = `${LAST_SESSION_PREFIX}${profile ?? ""}`;
    if (sessionId) localStorage.setItem(key, sessionId);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Move a draft when the pane was re-scoped (e.g. a fresh conversation was
 * assigned its stored id). No-op when the source is empty.
 */
export function moveDraft(
  profile: string | undefined,
  fromScope: string,
  toScope: string,
): void {
  if (fromScope === toScope) return;
  const text = readDraft(profile, fromScope);
  if (!text) return;
  writeDraft(profile, toScope, text);
  writeDraft(profile, fromScope, "");
}
