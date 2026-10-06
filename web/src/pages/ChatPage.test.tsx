// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hub = vi.hoisted(() => {
  const eventHandlers = new Map<string, Set<(event: unknown) => void>>();
  const stateHandlers = new Set<(state: string) => void>();
  const requestHandlers: Array<(request: unknown) => boolean | void> = [];
  return {
    calls: [] as Array<{ method: string; params: Record<string, unknown> }>,
    responses: new Map<string, (params: Record<string, unknown>) => unknown>(),
    failures: new Map<string, Error>(),
    eventHandlers,
    stateHandlers,
    requestHandlers,
    emit(type: string, payload: unknown, overrides: Record<string, unknown> = {}) {
      for (const handler of eventHandlers.get(type) ?? []) {
        handler({ type, payload, ...overrides });
      }
    },
    emitState(state: string) {
      for (const handler of [...stateHandlers]) handler(state);
    },
    reset() {
      this.calls.length = 0;
      this.responses.clear();
      this.failures.clear();
      eventHandlers.clear();
      stateHandlers.clear();
      requestHandlers.length = 0;
    },
    methods() {
      return this.calls.map((call) => call.method);
    },
    callsFor(method: string) {
      return this.calls.filter((call) => call.method === method).map((call) => call.params);
    },
  };
});

vi.mock("@/lib/gatewayClient", () => ({
  GatewayClient: class {
    connectionState = "open";
    async connect() {
      hub.emitState("open");
    }
    close() {}
    async request(method: string, params: Record<string, unknown> = {}) {
      hub.calls.push({ method, params });
      const failure = hub.failures.get(method);
      if (failure) throw failure;
      const responder = hub.responses.get(method);
      return responder ? responder(params) : {};
    }
    on(type: string, handler: (event: unknown) => void) {
      const set = hub.eventHandlers.get(type) ?? new Set();
      hub.eventHandlers.set(type, set);
      set.add(handler);
      return () => set.delete(handler);
    }
    onState(handler: (state: string) => void) {
      hub.stateHandlers.add(handler);
      handler("open");
      return () => hub.stateHandlers.delete(handler);
    }
    onRequest(handler: (request: unknown) => boolean | void) {
      hub.requestHandlers.push(handler);
      return () => undefined;
    }
  },
}));

vi.mock("@/lib/api", () => ({
  api: {
    getSessions: async () => ({ sessions: [], total: 0, limit: 30, offset: 0 }),
    searchSessions: async () => ({ results: [] }),
    getChatWorkspaces: async () => ({
      projects: [],
      repos: [],
      default_cwd: "",
      home: "",
      scan_enabled: false,
    }),
  },
}));

import ChatPage from "./ChatPage";

let container: HTMLDivElement;
let root: Root;

let navigateTo: ((to: string) => void) | null = null;
let hostControl: { setActive: (active: boolean) => void } | null = null;

function NavProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    navigateTo = navigate;
    return () => {
      navigateTo = null;
    };
  }, [navigate]);
  return null;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function HostHarness({
  initialEntry,
  onReady,
}: {
  initialEntry: string;
  onReady: (control: { setActive: (active: boolean) => void }) => void;
}) {
  const [active, setActive] = useState(true);
  useEffect(() => {
    onReady({ setActive });
  }, [onReady]);
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <NavProbe />
      <LocationProbe />
      <ChatPage isActive={active} />
    </MemoryRouter>
  );
}

function render(ui: ReactNode) {
  return act(async () => {
    root.render(<MemoryRouter initialEntries={["/chat"]}>{ui}</MemoryRouter>);
  });
}

/** Render the host harness (persistent across active/route changes). */
async function renderHost(initialEntry: string) {
  navigateTo = null;
  hostControl = null;
  await act(async () => {
    root.render(
      <HostHarness
        initialEntry={initialEntry}
        onReady={(control) => {
          hostControl = control;
        }}
      />,
    );
  });
}

function textarea(): HTMLTextAreaElement {
  const element = container.querySelector<HTMLTextAreaElement>(
    '[data-testid="chat-input"]',
  );
  if (!element) throw new Error("chat textarea not found");
  return element;
}

function typeDraft(value: string) {
  const element = textarea();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function pressEnter() {
  await act(async () => {
    textarea().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createdSession(runtime = "rt-1", stored = "st-1") {
  return {
    session_id: runtime,
    stored_session_id: stored,
    message_count: 0,
    messages: [],
    info: { title: "New chat", model: "test/model" },
  };
}

beforeEach(() => {
  hub.reset();
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChatPage native chat", () => {
  it("renders the empty state without creating a session", async () => {
    await render(<ChatPage />);
    expect(container.textContent).toContain("How can I help?");
    expect(hub.methods()).not.toContain("session.create");
  });

  it("creates one session on first send and streams the reply", async () => {
    hub.responses.set("session.create", () => createdSession());
    hub.responses.set("prompt.submit", () => ({ status: "streaming" }));
    await render(<ChatPage />);

    await act(async () => {
      typeDraft("hello");
    });
    await pressEnter();

    expect(hub.methods().filter((method) => method === "session.create")).toHaveLength(1);
    const submits = hub.callsFor("prompt.submit");
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ session_id: "rt-1", text: "hello" });
    expect(container.textContent).toContain("hello");

    await act(async () => {
      hub.emit("message.start", undefined, { session_id: "rt-1" });
      hub.emit("message.delta", { text: "Hi " }, { session_id: "rt-1" });
      hub.emit("message.delta", { text: "there" }, { session_id: "rt-1" });
    });
    expect(container.textContent).toContain("Hi there");

    await act(async () => {
      hub.emit(
        "message.complete",
        { text: "Hi there", status: "complete" },
        { session_id: "rt-1" },
      );
    });
    expect(container.textContent).toContain("Hi there");
  });

  it("keeps the draft when sending fails", async () => {
    hub.responses.set("session.create", () => createdSession());
    hub.failures.set("prompt.submit", new Error("gateway refused"));
    await render(<ChatPage />);

    await act(async () => {
      typeDraft("keep this");
    });
    await pressEnter();

    expect(textarea().value).toBe("keep this");
    expect(container.textContent).toContain("not sent");
  });

  it("shows an approval card and answers it explicitly", async () => {
    hub.responses.set("session.create", () => createdSession());
    hub.responses.set("prompt.submit", () => ({ status: "streaming" }));
    await render(<ChatPage />);
    await act(async () => {
      typeDraft("run something dangerous");
    });
    await pressEnter();

    const responded: Array<Record<string, unknown>> = [];
    const request = {
      id: "req-1",
      method: "approval",
      params: {
        session_id: "rt-1",
        request_id: "ap-1",
        command: "rm -rf build",
        tool_name: "shell",
        choices: ["once", "deny"],
      },
      respond: (result: Record<string, unknown>) => responded.push(result),
      fail: () => undefined,
    };
    await act(async () => {
      for (const handler of hub.requestHandlers) {
        if (handler(request) !== false) break;
      }
    });
    expect(container.querySelector('[data-chat-request="approval"]')).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-chat-approval="deny"]')
        ?.click();
    });
    expect(responded).toEqual([{ choice: "deny" }]);
    expect(container.querySelector('[data-chat-request="approval"]')).toBeNull();
  });

  it("keeps the conversation when returning from another admin route", async () => {
    hub.responses.set("session.resume", () => ({
      ...createdSession("rt-1", "st-1"),
      messages: [{ role: "assistant", text: "kept reply", row_id: 1 }],
    }));
    await renderHost("/chat?resume=st-1");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("kept reply");
    });

    // Sidebar navigation mounts the host hidden on another route (no resume in
    // that route's query).
    await act(async () => {
      navigateTo?.("/skills");
    });
    await act(async () => {
      hostControl?.setActive(false);
    });
    // Coming back to /chat shows the remembered conversation, not an empty pane.
    await act(async () => {
      hostControl?.setActive(true);
    });

    expect(container.textContent).toContain("kept reply");
    expect(hub.methods()).not.toContain("session.create");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toContain(
      "resume=st-1",
    );
  });

  it.each(["button", "command"])("keeps an explicit new chat new after a navigation round-trip (%s)", async (action) => {
    hub.responses.set("session.resume", () => ({
      ...createdSession("rt-1", "st-1"),
      messages: [{ role: "assistant", text: "kept reply", row_id: 1 }],
    }));
    await renderHost("/chat?resume=st-1");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("kept reply");
    });

    if (action === "command") {
      await act(async () => { typeDraft("/new"); });
      await pressEnter();
    } else {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[data-chat-action="new-chat"]')
          ?.click();
      });
    }
    await act(async () => {
      navigateTo?.("/skills");
    });
    await act(async () => {
      hostControl?.setActive(false);
    });
    await act(async () => {
      hostControl?.setActive(true);
    });

    expect(container.textContent).toContain("How can I help?");
    expect(hub.methods()).not.toContain("session.create");
    expect(container.querySelector('[data-testid="location"]')?.textContent).not.toContain(
      "resume=",
    );
  });
});
