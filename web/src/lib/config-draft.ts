/**
 * Scoped local draft for the Config page.
 *
 * The dashboard router is a plain BrowserRouter, so there is no data-router
 * `useBlocker` available for in-app navigation (and monkey-patching history
 * is exactly what we do not want). Instead, an unsaved edit is preserved in
 * per-tab `sessionStorage` keyed by profile and restored when the page mounts
 * again — route switches and profile switches therefore cannot silently drop
 * typed values, and reload/close is covered separately by `beforeunload`.
 *
 * The draft is versioned and time-bounded; a corrupt or foreign payload is
 * ignored rather than crashing the page.
 */

export const CONFIG_DRAFT_VERSION = 1;
export const CONFIG_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConfigDraft {
  version: typeof CONFIG_DRAFT_VERSION;
  savedAt: number;
  config: Record<string, unknown>;
  yamlMode: boolean;
  yamlText: string;
  activeCategory: string;
}

/** One bucket per profile so a restored draft can never leak across scopes. */
export function configDraftKey(profile: string | null | undefined): string {
  const scope = (profile ?? "").trim() || "default";
  return `hermes.config.draft.v${CONFIG_DRAFT_VERSION}.${scope}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Private browsing / disabled storage: drafts are best-effort.
    return null;
  }
}

export function readConfigDraft(key: string, now = Date.now()): ConfigDraft | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConfigDraft>;
    if (parsed.version !== CONFIG_DRAFT_VERSION) return null;
    if (!parsed.config || typeof parsed.config !== "object") return null;
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > CONFIG_DRAFT_TTL_MS) {
      store.removeItem(key);
      return null;
    }
    return {
      version: CONFIG_DRAFT_VERSION,
      savedAt: parsed.savedAt,
      config: parsed.config,
      yamlMode: parsed.yamlMode === true,
      yamlText: typeof parsed.yamlText === "string" ? parsed.yamlText : "",
      activeCategory:
        typeof parsed.activeCategory === "string" ? parsed.activeCategory : "",
    };
  } catch {
    store.removeItem(key);
    return null;
  }
}

export function writeConfigDraft(
  key: string,
  draft: Omit<ConfigDraft, "version" | "savedAt">,
): void {
  const store = storage();
  if (!store) return;
  try {
    const payload: ConfigDraft = {
      version: CONFIG_DRAFT_VERSION,
      savedAt: Date.now(),
      config: draft.config,
      yamlMode: draft.yamlMode,
      yamlText: draft.yamlText,
      activeCategory: draft.activeCategory,
    };
    store.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota or serialization failure: keep working without a draft.
  }
}

export function clearConfigDraft(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}
