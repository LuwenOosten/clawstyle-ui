// @vitest-environment jsdom
//
// Focus/escape/restore contract for the shared modal hook:
//   1. opening moves focus to the `data-autofocus` control, an editable
//      control, or the first focusable one in that order;
//   2. Tab / Shift+Tab wrap inside the modal instead of escaping the page;
//   3. Escape reaches only the topmost open modal;
//   4. closing restores focus to the element that was focused before open.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { useModalBehavior } from "./useModalBehavior";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function Dialog({
  children,
  onClose,
  open,
}: {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
}) {
  const ref = useModalBehavior({ open, onClose });
  if (!open) return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true">
      {children}
    </div>,
    document.body,
  );
}

function Trigger() {
  const [open, setOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const outerClose = vi.fn(() => setOpen(false));
  const nestedClose = vi.fn(() => setNestedOpen(false));

  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        open
      </button>
      <Dialog onClose={outerClose} open={open}>
        <button data-testid="outer-first">outer first</button>
        <input data-testid="outer-input" />
        <button data-testid="outer-last">outer last</button>
        <button data-testid="open-nested" onClick={() => setNestedOpen(true)}>
          nested
        </button>
        <Dialog onClose={nestedClose} open={nestedOpen}>
          <button data-testid="nested-first" data-autofocus>
            nested first
          </button>
          <button data-testid="nested-last">nested last</button>
        </Dialog>
      </Dialog>
    </div>
  );
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Trigger />);
  });
}

function byTestId(id: string): HTMLElement {
  return document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
}

async function press(key: string, shiftKey = false) {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, shiftKey }),
    );
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

describe("useModalBehavior", () => {
  it("focuses the marked control on open and restores the trigger on close", async () => {
    await mount();
    byTestId("trigger").focus();

    await act(async () => byTestId("trigger").click());
    // `data-autofocus` on the nested dialog is not rendered yet; the outer
    // dialog has no marker, so the first editable control wins.
    expect(document.activeElement).toBe(byTestId("outer-input"));

    await press("Escape");
    expect(document.activeElement).toBe(byTestId("trigger"));
  });

  it("prefers data-autofocus over the first editable control", async () => {
    await mount();
    await act(async () => byTestId("trigger").click());
    await act(async () => byTestId("open-nested").click());

    expect(document.activeElement).toBe(byTestId("nested-first"));
  });

  it("wraps Tab and Shift+Tab inside the topmost modal", async () => {
    await mount();
    await act(async () => byTestId("trigger").click());

    // `open-nested` is the last focusable control in the outer dialog.
    byTestId("open-nested").focus();
    await press("Tab");
    expect(document.activeElement).toBe(byTestId("outer-first"));

    await press("Tab", true);
    expect(document.activeElement).toBe(byTestId("open-nested"));
  });

  it("delivers Escape to the topmost modal only", async () => {
    await mount();
    await act(async () => byTestId("trigger").click());
    await act(async () => byTestId("open-nested").click());

    await press("Escape");
    // The nested dialog is gone; the outer one is still open.
    expect(document.querySelector('[data-testid="nested-first"]')).toBeNull();
    expect(byTestId("outer-first")).toBeTruthy();

    await press("Escape");
    expect(document.querySelector('[data-testid="outer-first"]')).toBeNull();
  });
});
