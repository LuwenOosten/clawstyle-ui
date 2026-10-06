// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatApprovalCard } from "./ChatApprovalCard";
import { ChatClarifyCard } from "./ChatClarifyCard";
import type { ChatApprovalRequest } from "@/features/chat/types";

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

function button(action: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`[data-chat-approval="${action}"]`);
  if (!element) throw new Error(`approval button ${action} not found`);
  return element;
}

describe("ChatApprovalCard", () => {
  const baseRequest: ChatApprovalRequest = {
    id: "req-1",
    method: "approval",
    params: {
      session_id: "rt-1",
      request_id: "ap-1",
      command: "rm -rf build",
      description: "dangerous",
      tool_name: "shell",
      choices: ["once", "session", "always", "deny"],
      allow_permanent: true,
      allow_session: true,
    },
  };

  it("renders every allowed decision and answers on click", async () => {
    const onRespond = vi.fn();
    await act(async () => {
      root.render(<ChatApprovalCard request={baseRequest} onRespond={onRespond} />);
    });
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(container.textContent).toContain("rm -rf build");
    // The card takes focus as a container so Enter cannot approve by accident.
    expect(document.activeElement).toBe(
      container.querySelector('[role="alertdialog"]'),
    );

    await act(async () => button("once").click());
    expect(onRespond).toHaveBeenCalledWith("once");
    await act(async () => button("session").click());
    expect(onRespond).toHaveBeenCalledWith("session");
    await act(async () => button("always").click());
    expect(onRespond).toHaveBeenCalledWith("always");
    await act(async () => button("deny").click());
    expect(onRespond).toHaveBeenCalledWith("deny");
  });

  it("hides session/always when the backend disallows them", async () => {
    const onRespond = vi.fn();
    await act(async () => {
      root.render(
        <ChatApprovalCard
          request={{
            ...baseRequest,
            params: {
              ...baseRequest.params,
              choices: ["once", "deny"],
              allow_permanent: false,
              allow_session: false,
            },
          }}
          onRespond={onRespond}
        />,
      );
    });
    expect(container.querySelector('[data-chat-approval="session"]')).toBeNull();
    expect(container.querySelector('[data-chat-approval="always"]')).toBeNull();
    expect(container.querySelector('[data-chat-approval="once"]')).not.toBeNull();
    expect(container.querySelector('[data-chat-approval="deny"]')).not.toBeNull();
  });
});

describe("ChatClarifyCard", () => {
  it("collects a single-choice answer", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <ChatClarifyCard
          request={{
            id: "req-2",
            method: "clarify",
            params: {
              session_id: "rt-1",
              questions: [
                { qid: "env", question: "Which env?", choices: ["dev", "prod"] },
              ],
            },
          }}
          onSubmit={onSubmit}
          onSkip={vi.fn()}
        />,
      );
    });
    const prod = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(
      (input) => input.parentElement?.textContent?.includes("prod"),
    );
    await act(async () => {
      prod?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-chat-clarify="submit"]')?.click();
    });
    expect(onSubmit).toHaveBeenCalledWith({ env: "prod" });
  });

  it("serializes multi-select answers as a JSON array string", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <ChatClarifyCard
          request={{
            id: "req-3",
            method: "clarify",
            params: {
              session_id: "rt-1",
              questions: [
                {
                  qid: "regions",
                  question: "Regions?",
                  choices: ["eu", "us"],
                  multi_select: true,
                },
              ],
            },
          }}
          onSubmit={onSubmit}
          onSkip={vi.fn()}
        />,
      );
    });
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      boxes[0].click();
      boxes[1].click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-chat-clarify="submit"]')?.click();
    });
    expect(JSON.parse(onSubmit.mock.calls[0][0].regions)).toEqual(["eu", "us"]);
  });

  it("submits skipped questions as null and supports skip-all", async () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();
    await act(async () => {
      root.render(
        <ChatClarifyCard
          request={{
            id: "req-4",
            method: "clarify",
            params: {
              session_id: "rt-1",
              questions: [{ qid: "note", question: "Anything?" }],
            },
          }}
          onSubmit={onSubmit}
          onSkip={onSkip}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-chat-clarify="submit"]')?.click();
    });
    expect(onSubmit).toHaveBeenCalledWith({ note: null });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-chat-clarify="skip"]')?.click();
    });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
