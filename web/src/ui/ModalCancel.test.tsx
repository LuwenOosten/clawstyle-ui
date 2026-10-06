// @vitest-environment jsdom
//
// Regression for the v2 browser finding: a footer Cancel must go through the
// modal's dirty guard exactly like Escape/backdrop/close-button. The parent
// in this harness mirrors Cron/Webhooks: it resets its draft on close, so an
// explicitly discarded draft never reappears when the dialog is reopened.

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Modal } from "./Modal";
import { ModalCancel } from "./ModalCancel";
import { Button } from "./Button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
}

async function clickText(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (el) => el.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

function FormHarness({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const dirty = draft.length > 0;
  return (
    <>
      <button data-testid="open" onClick={() => setOpen(true)}>
        open
      </button>
      <Modal
        open={open}
        dirty={dirty}
        title="New job"
        onClose={() => {
          setOpen(false);
          // The Cron/Webhooks contract: every dismissal resets the draft.
          setDraft("");
          onClosed?.();
        }}
        footer={
          <>
            <ModalCancel>Cancel</ModalCancel>
            <Button variant="primary" data-autofocus>
              Create
            </Button>
          </>
        }
      >
        <input
          aria-label="Job name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </Modal>
    </>
  );
}

describe("footer Cancel shares the dirty guard", () => {
  it("asks before discarding and keeps the draft for keep-editing", async () => {
    const closed = vi.fn();
    await mount(<FormHarness onClosed={closed} />);
    await clickText("open");
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Job name"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "nightly report");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      // Simulate typing focus; the confirmation's origin should be this field.
      input.focus();
    });

    // Footer Cancel with dirty data must prompt, not close.
    await clickText("Cancel");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(closed).not.toHaveBeenCalled();

    // Keep editing retains the typed value and returns focus to the form
    // control the confirmation was opened over.
    await clickText("Keep editing");
    const kept = document.querySelector<HTMLInputElement>(
      'input[aria-label="Job name"]',
    );
    expect(kept?.value).toBe("nightly report");
    expect(document.activeElement).toBe(kept);
    expect(closed).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    // Second Cancel → Discard closes and runs the parent reset.
    await clickText("Cancel");
    await clickText("Discard");
    expect(closed).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes without prompting when the form is clean", async () => {
    const closed = vi.fn();
    await mount(<FormHarness onClosed={closed} />);
    await clickText("open");
    await clickText("Cancel");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a discarded draft on reopen", async () => {
    await mount(<FormHarness />);
    await clickText("open");
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Job name"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "draft to drop");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickText("Cancel");
    await clickText("Discard");

    await clickText("open");
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Job name"]')
        ?.value,
    ).toBe("");
  });
});
