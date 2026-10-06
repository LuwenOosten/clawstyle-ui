// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
}
async function escape() {
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
}
async function clickText(text: string) {
  const button = [...document.querySelectorAll("button")].find(el => el.textContent === text);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe("shared form modal user contract", () => {
  it("retains form state through keep-editing and requires explicit discard", async () => {
    const closed = vi.fn();
    function Form() {
      const [open, setOpen] = useState(true);
      return <Modal open={open} dirty title="Edit task" onClose={() => { closed(); setOpen(false); }}>
        <input aria-label="Task name" defaultValue="Unsaved task" autoFocus />
      </Modal>;
    }
    await mount(<Form />);
    await escape();
    const alert = document.querySelector('[role="alertdialog"]')!;
    expect(alert).not.toBeNull();
    // A visible title must also provide the accessible dialog name.
    const titleId = alert.getAttribute("aria-labelledby");
    expect(titleId && document.getElementById(titleId)?.textContent).toBeTruthy();
    await clickText("Keep editing");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Task name"]')?.value).toBe("Unsaved task");
    expect(closed).not.toHaveBeenCalled();
    await escape();
    await clickText("Discard");
    expect(closed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("blocks Escape, close button and backdrop while a submission is pending", async () => {
    const closed = vi.fn();
    await mount(<Modal open pending dirty title="Save task" onClose={closed}><input autoFocus /></Modal>);
    await escape();
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    expect(close.disabled).toBe(true);
    await act(async () => close.click());
    const overlay = document.querySelector('[data-ui-modal-overlay]')!;
    await act(async () => overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(closed).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});

describe("shared form modal error surface", () => {
  it("keeps typed values and shows a failed submit in the footer alert", async () => {
    await mount(
      <Modal
        open
        title="Save task"
        onClose={() => {}}
        footerStatus="Save failed: network down"
        statusTone="error"
        footer={<button type="button">Save</button>}
      >
        <input aria-label="Task name" defaultValue="keep me" autoFocus />
      </Modal>,
    );
    const alert = document.querySelector(
      '.ui-modal__footer-status[role="alert"]',
    );
    expect(alert?.textContent).toContain("Save failed");
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Task name"]')
        ?.value,
    ).toBe("keep me");
  });
});

describe("shared modal initial focus", () => {
  it("focuses the explicitly marked field before an earlier select", async () => {
    await mount(
      <Modal open title="New job" onClose={() => {}}>
        <select aria-label="Profile" defaultValue="default">
          <option value="default">default</option>
        </select>
        <input aria-label="Job name" data-autofocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(
      document.querySelector('input[aria-label="Job name"]'),
    );
  });
});
