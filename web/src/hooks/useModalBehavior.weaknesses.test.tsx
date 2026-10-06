// @vitest-environment jsdom
//
// Regression coverage for the modal-contract weaknesses called out in the
// v1 review:
//   1. a nested dialog restores focus to its trigger INSIDE the parent,
//      not to the page element that opened the parent;
//   2. out-of-order unmounts cannot unlock body scroll while a parent
//      dialog is still open;
//   3. hidden / inert / aria-hidden ancestors are never focus targets.

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

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(node));
}

function byTestId(id: string): HTMLElement {
  return document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
}

async function press(key: string) {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    );
  });
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  document.body.style.overflow = "";
});

describe("useModalBehavior — nested restore", () => {
  it("restores focus to the nested trigger inside the still-open parent", async () => {
    function Harness() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return (
        <>
          <button data-testid="page-trigger" onClick={() => setOuter(true)}>
            open outer
          </button>
          <Dialog open={outer} onClose={() => setOuter(false)}>
            <button data-testid="inner-trigger" onClick={() => setInner(true)}>
              open inner
            </button>
            <Dialog open={inner} onClose={() => setInner(false)}>
              <button data-testid="inner-field" data-autofocus>
                inner field
              </button>
            </Dialog>
          </Dialog>
        </>
      );
    }

    await mount(<Harness />);
    byTestId("page-trigger").focus();
    await click(byTestId("page-trigger"));
    byTestId("inner-trigger").focus();
    await click(byTestId("inner-trigger"));
    expect(document.activeElement).toBe(byTestId("inner-field"));

    await press("Escape");
    // Parent stays open; focus returns to the button that opened the child.
    expect(document.querySelector('[data-testid="inner-field"]')).toBeNull();
    expect(byTestId("inner-trigger")).toBeTruthy();
    expect(document.activeElement).toBe(byTestId("inner-trigger"));
  });
});

describe("useModalBehavior — body lock reference counting", () => {
  it("keeps the lock when a parent unmounts before its child", async () => {
    function Outer() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onClose={() => setOpen(false)}>
          <button data-testid="close-outer" onClick={() => setOpen(false)}>
            close outer
          </button>
        </Dialog>
      );
    }
    function Harness() {
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <>
          <Outer />
          <Dialog open={innerOpen} onClose={() => setInnerOpen(false)}>
            <button data-testid="close-inner" onClick={() => setInnerOpen(false)}>
              close inner
            </button>
          </Dialog>
        </>
      );
    }

    await mount(<Harness />);
    expect(document.body.style.overflow).toBe("hidden");

    // Out-of-order: remove the outer dialog while the inner one is still open.
    await click(byTestId("close-outer"));
    expect(document.body.style.overflow).toBe("hidden");

    await click(byTestId("close-inner"));
    expect(document.body.style.overflow).toBe("");
  });
});

describe("useModalBehavior — visibility filtering", () => {
  it("skips hidden, inert and aria-hidden ancestors when choosing initial focus", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onClose={() => setOpen(false)}>
          <input data-testid="hidden-input" hidden />
          <div inert>
            <button data-testid="inert-button">inert</button>
          </div>
          <div aria-hidden="true">
            <button data-testid="aria-button">aria hidden</button>
          </div>
          <button data-testid="visible-button">visible</button>
        </Dialog>
      );
    }

    await mount(<Harness />);
    expect(document.activeElement).toBe(byTestId("visible-button"));
  });

  it("does not restore to an origin removed from the DOM", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          {!open && (
            <button data-testid="remove-me" onClick={() => setOpen(true)}>
              open
            </button>
          )}
          <Dialog open={open} onClose={() => setOpen(false)}>
            <button data-testid="inside" data-autofocus>
              inside
            </button>
          </Dialog>
        </>
      );
    }
    await mount(<Harness />);
    byTestId("remove-me").focus();
    await click(byTestId("remove-me"));
    // React removed the trigger with the state update; Escape must not throw
    // trying to restore focus into a detached node.
    expect(document.querySelector('[data-testid="remove-me"]')).toBeNull();

    await press("Escape");
    expect(document.activeElement?.isConnected).not.toBe(false);
  });
});

describe("useModalBehavior — escape ownership", () => {
  it("ignores Escape a dropdown already consumed", async () => {
    const close = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onClose={() => { close(); setOpen(false); }}>
          <input data-testid="field" autoFocus />
        </Dialog>
      );
    }
    await mount(<Harness />);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    await act(async () => byTestId("field").dispatchEvent(event));
    expect(close).not.toHaveBeenCalled();
  });
});

describe("useModalBehavior — topmost restore", () => {
  it("does not restore focus behind a modal that is still open", async () => {
    function Harness() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return (
        <>
          <button data-testid="page-trigger" onClick={() => setOuter(true)}>
            page
          </button>
          <Dialog open={outer} onClose={() => setOuter(false)}>
            <button data-testid="open-inner" onClick={() => setInner(true)}>
              open inner
            </button>
            <button data-testid="close-outer" onClick={() => setOuter(false)}>
              close outer
            </button>
          </Dialog>
          <Dialog open={inner} onClose={() => setInner(false)}>
            <button data-testid="inner-field" data-autofocus>
              inner field
            </button>
          </Dialog>
        </>
      );
    }
    await mount(<Harness />);
    byTestId("page-trigger").focus();
    await click(byTestId("page-trigger"));
    await click(byTestId("open-inner"));
    expect(document.activeElement).toBe(byTestId("inner-field"));

    // Unmount the outer dialog while the inner one stays open. Focus must
    // remain inside the remaining topmost modal, not fly back to the page
    // trigger behind it.
    await click(byTestId("close-outer"));
    expect(byTestId("inner-field")).toBeTruthy();
    expect(document.activeElement).toBe(byTestId("inner-field"));
    expect(document.activeElement).not.toBe(byTestId("page-trigger"));
  });
});

describe("useModalBehavior — visibility filtering", () => {
  it("skips controls inside a closed <details> and a disabled fieldset", async () => {
    function Harness() {
      return (
        <Dialog open onClose={() => {}}>
          <details>
            <summary data-testid="summary">More</summary>
            <button data-testid="closed-details-button">closed</button>
          </details>
          <fieldset disabled>
            <button data-testid="disabled-fieldset-button">disabled</button>
          </fieldset>
          <button data-testid="first-real">first real</button>
        </Dialog>
      );
    }
    await mount(<Harness />);
    expect(document.activeElement).toBe(byTestId("summary"));
  });

  it("falls back when the marked autofocus target is hidden", async () => {
    function Harness() {
      return (
        <Dialog open onClose={() => {}}>
          <input data-testid="hidden-marker" data-autofocus hidden />
          <button data-testid="first-fallback">fallback</button>
        </Dialog>
      );
    }
    await mount(<Harness />);
    expect(document.activeElement).toBe(byTestId("first-fallback"));
  });
});
