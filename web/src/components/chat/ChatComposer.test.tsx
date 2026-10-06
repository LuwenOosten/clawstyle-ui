// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./ChatComposer";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function textarea(): HTMLTextAreaElement {
  const element = container.querySelector<HTMLTextAreaElement>(
    '[data-testid="chat-input"]',
  );
  if (!element) throw new Error("composer textarea not found");
  return element;
}

function pressEnter(options: KeyboardEventInit = {}) {
  return act(async () => {
    textarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

describe("ChatComposer", () => {
  it("focuses the textarea on mount", async () => {
    await act(async () => {
      root.render(
        <ChatComposer
          draft=""
          scopeKey="scope-a"
          onDraftChange={() => {}}
          sendPhase="idle"
          running={false}
          onSend={async () => true}
          onStop={() => {}}
        />,
      );
    });
    expect(document.activeElement).toBe(textarea());
  });

  it("sends on Enter and clears the draft on success", async () => {
    const onSend = vi.fn(async () => true);
    const onDraftChange = vi.fn();
    await act(async () => {
      root.render(
        <ChatComposer
          draft="hello"
          scopeKey="scope-a"
          onDraftChange={onDraftChange}
          sendPhase="idle"
          running={false}
          onSend={onSend}
          onStop={() => {}}
        />,
      );
    });

    await pressEnter();
    expect(onSend).toHaveBeenCalledWith("hello", []);
    expect(onDraftChange).toHaveBeenCalledWith("");
  });

  it("does not send on Shift+Enter", async () => {
    const onSend = vi.fn(async () => true);
    await act(async () => {
      root.render(
        <ChatComposer
          draft="hello"
          scopeKey="scope-a"
          onDraftChange={() => {}}
          sendPhase="idle"
          running={false}
          onSend={onSend}
          onStop={() => {}}
        />,
      );
    });
    await pressEnter({ shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores Enter during IME composition", async () => {
    const onSend = vi.fn(async () => true);
    await act(async () => {
      root.render(
        <ChatComposer
          draft="ni hao"
          scopeKey="scope-a"
          onDraftChange={() => {}}
          sendPhase="idle"
          running={false}
          onSend={onSend}
          onStop={() => {}}
        />,
      );
    });

    await act(async () => {
      textarea().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await pressEnter({ isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => {
      textarea().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await pressEnter();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("restores the draft when sending fails", async () => {
    const onSend = vi.fn(async () => false);
    const onDraftChange = vi.fn();
    await act(async () => {
      root.render(
        <ChatComposer
          draft="keep me"
          scopeKey="scope-a"
          onDraftChange={onDraftChange}
          sendPhase="idle"
          running={false}
          onSend={onSend}
          onStop={() => {}}
        />,
      );
    });
    await pressEnter();
    expect(onDraftChange).toHaveBeenNthCalledWith(1, "");
    expect(onDraftChange).toHaveBeenNthCalledWith(2, "keep me");
    expect(container.textContent).toContain("restored");
  });

  it("shows Stop while a turn runs and never sends on Enter", async () => {
    const onSend = vi.fn(async () => true);
    const onStop = vi.fn();
    await act(async () => {
      root.render(
        <ChatComposer
          draft="queued text"
          scopeKey="scope-a"
          onDraftChange={() => {}}
          sendPhase="idle"
          running
          onSend={onSend}
          onStop={onStop}
        />,
      );
    });
    const stop = container.querySelector('[data-chat-action="stop"]');
    expect(stop).not.toBeNull();
    expect(container.querySelector('[data-chat-action="send"]')).toBeNull();
    await pressEnter();
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => {
      (stop as HTMLButtonElement).click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("disables send while a create/submit is in flight", async () => {
    await act(async () => {
      root.render(
        <ChatComposer
          draft="hi"
          scopeKey="scope-a"
          onDraftChange={() => {}}
          sendPhase="creating"
          running={false}
          onSend={async () => true}
          onStop={() => {}}
        />,
      );
    });
    const send = container.querySelector<HTMLButtonElement>('[data-chat-action="send"]');
    expect(send?.disabled).toBe(true);
    await pressEnter();
    expect(send?.disabled).toBe(true);
  });

  it("clears attachments when the pane scope changes", async () => {
    await act(async () => {
      root.render(
        <ChatComposer
          draft=""
          scopeKey="pane-a"
          onDraftChange={() => {}}
          sendPhase="idle"
          running={false}
          onSend={async () => true}
          onStop={() => {}}
        />,
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="chat-file-input"]',
    );
    const file = new File(["x"], "shot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("shot.png");

    await act(async () => {
      root.render(
        <ChatComposer
          draft=""
          scopeKey="pane-b"
          onDraftChange={() => {}}
          sendPhase="idle"
          running={false}
          onSend={async () => true}
          onStop={() => {}}
        />,
      );
    });
    expect(container.textContent).not.toContain("shot.png");
  });

  it("does not restore a failed draft into a newly selected pane", async () => {
    let release!: (ok: boolean) => void;
    const onSend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const onDraftChange = vi.fn();
    await act(async () => {
      root.render(
        <ChatComposer
          draft="old pane text"
          scopeKey="pane-a"
          onDraftChange={onDraftChange}
          sendPhase="idle"
          running={false}
          onSend={onSend}
          onStop={() => {}}
        />,
      );
    });
    await pressEnter();
    expect(onDraftChange).toHaveBeenCalledWith("");

    await act(async () => {
      root.render(
        <ChatComposer
          draft="new pane text"
          scopeKey="pane-b"
          onDraftChange={onDraftChange}
          sendPhase="idle"
          running={false}
          onSend={onSend}
          onStop={() => {}}
        />,
      );
    });
    await act(async () => {
      release(false);
      await Promise.resolve();
    });
    expect(onDraftChange).not.toHaveBeenCalledWith("old pane text");
  });

  it("keeps send disabled for an image without a message", async () => {
    await act(async () => {
      root.render(
        <ChatComposer
          draft=""
          scopeKey="pane-a"
          onDraftChange={() => {}}
          sendPhase="idle"
          running={false}
          onSend={async () => true}
          onStop={() => {}}
        />,
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="chat-file-input"]',
    );
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "shot.png", { type: "image/png" })],
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[data-chat-action="send"]');
    expect(send?.disabled).toBe(true);
    expect(container.textContent).toContain("Add a message");
  });

  it("adds image attachments through the file input and sends them", async () => {
    const onSend = vi.fn(async () => true);
    await act(async () => {
      root.render(
        <ChatComposer
          draft="with image"
          scopeKey="scope-a"
          onDraftChange={() => {}}
          sendPhase="idle"
          running={false}
          onSend={onSend}
          onStop={() => {}}
        />,
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="chat-file-input"]',
    );
    const file = new File(["x"], "shot.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("shot.png");

    await pressEnter();
    expect(onSend).toHaveBeenCalledWith("with image", [file]);
  });
});
