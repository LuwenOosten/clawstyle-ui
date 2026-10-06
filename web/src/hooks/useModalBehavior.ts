import { useEffect, useRef } from "react";

/**
 * Hook that adds standard modal behaviors when `open` is true:
 * - Escape closes the modal — only the topmost open modal reacts, so a
 *   nested picker never dismisses its parent. Escape already consumed by a
 *   dropdown/listbox (`defaultPrevented`) is left alone.
 * - Focus moves to a sensible control on open and Tab / Shift+Tab wrap
 *   inside the modal instead of escaping to the page behind it.
 * - Body scroll is locked while any modal is open (reference-counted, so
 *   out-of-order unmounts cannot unlock a still-open parent).
 * - Focus is restored to the element that opened the modal on close —
 *   including a nested modal's trigger inside its parent.
 *
 * Dialogs that already implement their own focus management (Radix/DS
 * dialogs) must not use this hook as well: the Tab trap defers to any
 * dialog the container does not own, but two traps on the same dialog
 * still fight over `document.activeElement`.
 */
export function useModalBehavior({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the latest callback without re-running the open/close lifecycle
  // effect (an inline `onClose` identity changes on every parent render, and
  // re-running that effect would re-focus the first field mid-typing).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    // React applies `autoFocus` during commit, so by the time this effect
    // runs the dialog's own field may already own focus. Prefer the live
    // element when it is outside this dialog; otherwise walk the focus
    // history backwards for the most recent element outside this container.
    // That is how a nested dialog finds the trigger inside its parent that
    // opened it instead of escaping to the page behind the parent.
    const active = document.activeElement as HTMLElement | null;
    const origin = findFocusOrigin(container, active);

    const target = initialFocusTarget(container);
    if (target) {
      target.focus();
    } else {
      // Nothing focusable inside: give the trap a home so Escape/Tab still
      // have somewhere to land.
      if (!container.hasAttribute("tabindex")) container.tabIndex = -1;
      container.focus();
    }

    lockBodyScroll();
    OPEN_MODAL_STACK.push(container);

    return () => {
      const index = OPEN_MODAL_STACK.lastIndexOf(container);
      if (index >= 0) OPEN_MODAL_STACK.splice(index, 1);
      unlockBodyScroll();
      // Do not steal focus back to an element behind a modal that is still
      // open (e.g. an ancestor dialog unmounting while its child remains).
      // Restoring is correct when the origin lives inside a remaining modal
      // — that is the nested-dialog-closes case. When nothing is left, the
      // page owns focus again.
      if (shouldRestoreFocus(origin)) restoreFocus(origin);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A dropdown/listbox/combobox above the dialog consumed Escape
      // (Radix calls preventDefault and keeps the event bubbling) — the
      // dialog must not also close.
      if (e.isComposing || e.defaultPrevented) return;
      if (!isTopmost(containerRef.current)) return;

      const active = document.activeElement as HTMLElement | null;

      // A dialog this container does not own (Radix/DS, or another modal
      // layered above) holds focus right now — it owns Escape/Tab.
      if (containerRef.current && isInsideOtherDialog(containerRef.current, active)) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;

      const focusables = focusableWithin(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const inside = active != null && container.contains(active);

      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return containerRef;
}

/** Open modal containers. Topmost is decided by DOM order (portals append
 *  later containers after earlier ones), not effect order — nested dialogs
 *  mount child-first, so a push order would invert the visual stack. */
const OPEN_MODAL_STACK: HTMLElement[] = [];

function isTopmost(container: HTMLElement | null): boolean {
  if (container == null || !container.isConnected) return false;
  if (!OPEN_MODAL_STACK.includes(container)) return false;
  return OPEN_MODAL_STACK.every(
    (other) =>
      other === container ||
      other.isConnected === false ||
      (other.compareDocumentPosition(container) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  // `<summary>` is natively tabbable (it toggles its details) but carries no
  // tabindex attribute, so the attribute selector alone would miss it.
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const EDITABLE_SELECTOR =
  "input:not([type='hidden']), textarea, select, [contenteditable='true']";

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if ((el as HTMLButtonElement).disabled) return false;
  // `closest` catches hidden/inert/aria-hidden ANCESTORS, not just the
  // element itself — a field inside a collapsed `<details>` or an inert
  // subtree must not be a focus trap target.
  if (el.closest("[hidden]")) return false;
  if (el.closest("[inert]")) return false;
  if (el.closest("[aria-hidden='true']")) return false;
  if (isHiddenByClosedDetails(el)) return false;
  if (isDisabledByFieldset(el)) return false;
  if (typeof el.checkVisibility === "function") {
    try {
      if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) {
        return false;
      }
    } catch {
      // Older engines reject the options object; fall through to style checks.
    }
  }
  const style = window.getComputedStyle?.(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false;
  }
  return true;
}

/** Controls inside a closed `<details>` are not rendered/focusable, except
 *  the `<summary>` that toggles it. Nested closed details are walked too. */
function isHiddenByClosedDetails(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    const details: HTMLDetailsElement | null = node.closest("details");
    if (!details) return false;
    if (!details.open) {
      const summary = details.querySelector(":scope > summary");
      if (!summary || !summary.contains(el)) return true;
    }
    node = details.parentElement;
  }
  return false;
}

/** A descendant of `fieldset[disabled]` is unfocusable, except controls in
 *  the fieldset's first `<legend>` (the HTML spec's escape hatch). */
function isDisabledByFieldset(el: HTMLElement): boolean {
  const fieldset = el.closest("fieldset[disabled]");
  if (!fieldset) return false;
  const legend = fieldset.querySelector(":scope > legend");
  return !legend || !legend.contains(el);
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isVisible);
}

/** `data-autofocus` wins, then the native `autofocus` attribute, then the
 *  first editable control (form dialogs), then the first focusable control
 *  (confirm dialogs land on Cancel, which precedes Confirm in the markup).
 *  An explicit marker that is hidden/disabled falls through instead of
 *  leaving focus wherever React's `autoFocus` put it. */
function initialFocusTarget(container: HTMLElement): HTMLElement | null {
  const marked = [
    ...container.querySelectorAll<HTMLElement>("[data-autofocus]"),
    ...container.querySelectorAll<HTMLElement>("[autofocus]"),
  ];
  const explicit = marked.find((el) => isVisible(el) && el.isConnected);
  if (explicit) return explicit;
  const focusables = focusableWithin(container);
  return (
    focusables.find((el) => el.matches(EDITABLE_SELECTOR)) ??
    focusables[0] ??
    null
  );
}

function shouldRestoreFocus(origin: HTMLElement | null): boolean {
  if (OPEN_MODAL_STACK.length === 0) return true;
  if (!origin) return false;
  return OPEN_MODAL_STACK.some((other) => other.contains(origin));
}

function restoreFocus(origin: HTMLElement | null): void {
  if (!origin) return;
  if (!origin.isConnected) return;
  if (!isVisible(origin)) return;
  origin.focus?.();
}

/** True when focus currently sits in a dialog outside `container` (a Radix
 *  or DS dialog layered above this one, including a separately managed
 *  nested alert dialog). The role="dialog" wrapper that *contains* the
 *  hooked panel is not "another dialog". */
function isInsideOtherDialog(
  container: HTMLElement,
  active: HTMLElement | null,
): boolean {
  if (!active) return false;
  const dialog = active.closest(
    '[role="dialog"], [role="alertdialog"], [data-slot="dialog-content"]',
  );
  if (!dialog) return false;
  if (dialog.contains(container)) return false;
  if (container.contains(dialog)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Body scroll lock (reference counted)
// ---------------------------------------------------------------------------

let bodyLockCount = 0;
let bodyOverflowBeforeLock = "";

function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBodyScroll(): void {
  if (typeof document === "undefined") return;
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    document.body.style.overflow = bodyOverflowBeforeLock;
  }
}

// ---------------------------------------------------------------------------
// Focus-origin tracking
// ---------------------------------------------------------------------------

/** Last element focused outside every modal. Captured at module load so a
 *  dialog that mounts already-open (e.g. the model picker) still knows where
 *  focus came from even though React's `autoFocus` moved it first. */
let LAST_FOCUS_OUTSIDE_MODAL: HTMLElement | null = null;

/** Sequenced interaction log. React's `autoFocus` fires during commit, before
 *  this hook's effect, so by then the element that opened the dialog is no
 *  longer `document.activeElement`. We record focusin and pointerdown with a
 *  monotonically increasing sequence and, when restoring, pick the newest
 *  entry outside the dialog. Pointer events cover Safari, which does not move
 *  focus to a clicked button; focusin covers keyboard activation. */
interface InteractionEntry {
  el: HTMLElement;
  seq: number;
}

let INTERACTION_SEQ = 0;
const FOCUS_HISTORY: InteractionEntry[] = [];
const FOCUS_HISTORY_LIMIT = 12;
let LAST_POINTER: InteractionEntry | null = null;

function recordInteraction(target: EventTarget | null, pointer: boolean): void {
  if (!(target instanceof HTMLElement)) return;
  const entry: InteractionEntry = { el: target, seq: ++INTERACTION_SEQ };
  if (pointer) {
    LAST_POINTER = entry;
  } else {
    FOCUS_HISTORY.push(entry);
    if (FOCUS_HISTORY.length > FOCUS_HISTORY_LIMIT) FOCUS_HISTORY.shift();
    if (
      target.closest(
        '[aria-modal="true"], [role="alertdialog"], [data-slot="dialog-content"]',
      )
    ) {
      return;
    }
    LAST_FOCUS_OUTSIDE_MODAL = target;
  }
}

function findFocusOrigin(
  container: HTMLElement,
  active: HTMLElement | null,
): HTMLElement | null {
  if (active && active !== document.body && !container.contains(active)) {
    return active;
  }
  const candidates: InteractionEntry[] = [];
  const consider = (entry: InteractionEntry | null) => {
    if (!entry) return;
    if (entry.el === active) return;
    if (container.contains(entry.el)) return;
    if (!entry.el.isConnected) return;
    candidates.push(entry);
  };
  for (const entry of FOCUS_HISTORY) consider(entry);
  consider(LAST_POINTER);
  const best = candidates.reduce<InteractionEntry | null>(
    (acc, entry) => (!acc || entry.seq > acc.seq ? entry : acc),
    null,
  );
  return best?.el ?? LAST_FOCUS_OUTSIDE_MODAL;
}

/** Install once per window. Module re-evaluation under HMR (or a duplicated
 *  module instance) must not stack a second set of global listeners. */
const TRACKER_KEY = "__hermesModalFocusTrackerInstalled";

function ensureFocusTracker(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const global = window as unknown as Record<string, unknown>;
  if (global[TRACKER_KEY]) return;
  global[TRACKER_KEY] = true;
  document.addEventListener("focusin", (event) => recordInteraction(event.target, false), true);
  // Capture phase: the trigger may be removed from the DOM by the state
  // update, so read it on the way down rather than after React commits.
  document.addEventListener(
    "pointerdown",
    (event) => recordInteraction(event.target, true),
    true,
  );
  document.addEventListener(
    "mousedown",
    (event) => recordInteraction(event.target, true),
    true,
  );
}

ensureFocusTracker();
