// @vitest-environment jsdom
//
// The shared confirmation dialog must open on the SAFE action (Cancel) and
// keep every close path blocked while the confirmed action is in flight.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

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

describe("ConfirmDialog", () => {
  it("focuses Cancel on open, not the destructive confirm", async () => {
    await mount(
      <ConfirmDialog
        open
        destructive
        title="Delete job"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const active = document.activeElement as HTMLButtonElement | null;
    expect(active?.textContent).toBe("Cancel");
  });

  it("blocks Escape while loading", async () => {
    const onCancel = vi.fn();
    await mount(
      <ConfirmDialog
        open
        loading
        title="Deleting"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("routes Escape to the confirm's cancel handler when idle", async () => {
    const onCancel = vi.fn();
    await mount(
      <ConfirmDialog
        open
        title="Discard?"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
