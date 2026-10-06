// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModalBehavior } from "./useModalBehavior";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  document.body.style.overflow = "";
});

function Dialog({ open, close }: { open: boolean; close: () => void }) {
  const ref = useModalBehavior({ open, onClose: close });
  if (!open) return null;
  return <div role="dialog" aria-modal="true">
    <div ref={ref}>
      <button id="close-dialog" onClick={close}>Close</button>
      <input id="first-field" autoFocus />
      <button id="last-control">Submit</button>
    </div>
  </div>;
}

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button id="open-dialog" onClick={() => setOpen(true)}>Open</button>
    <Dialog open={open} close={() => { onClose(); setOpen(false); }} />
  </>;
}

async function mount(onClose?: () => void) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness onClose={onClose} />));
  const trigger = document.getElementById("open-dialog")!;
  trigger.focus();
  await act(async () => trigger.click());
  return trigger;
}

describe("actual dashboard dialog DOM contract", () => {
  it("traps Tab when the ref is on the panel inside the role=dialog wrapper", async () => {
    await mount();
    const last = document.getElementById("last-control")!;
    last.focus();
    const key = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => last.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.getElementById("close-dialog"));
  });

  it("restores the opening trigger after a React autoFocus field takes focus", async () => {
    const trigger = await mount();
    expect(document.activeElement).toBe(document.getElementById("first-field"));
    await act(async () => document.getElementById("close-dialog")!.click());
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the parent open when a dropdown already consumed Escape", async () => {
    const close = vi.fn();
    await mount(close);
    const field = document.getElementById("first-field")!;
    const key = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    key.preventDefault();
    await act(async () => field.dispatchEvent(key));
    expect(close).not.toHaveBeenCalled();
  });

  it("defers Escape to a separately managed nested alert dialog", async () => {
    const close = vi.fn();
    await mount(close);
    const nested = document.createElement("div");
    nested.setAttribute("role", "alertdialog");
    nested.innerHTML = '<button>Nested cancel</button>';
    document.body.append(nested);
    const button = nested.querySelector("button")!;
    button.focus();
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(close).not.toHaveBeenCalled();
    nested.remove();
  });
});
