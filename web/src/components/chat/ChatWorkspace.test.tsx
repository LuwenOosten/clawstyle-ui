// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialChatState } from "@/features/chat/state";
import type { ChatSnapshot } from "@/features/chat/controller";

const viewport = vi.hoisted(() => ({ narrow: false }));

vi.mock("@nous-research/ui/hooks/use-below-breakpoint", () => ({
  useBelowBreakpoint: () => viewport.narrow,
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

import { ChatWorkspace } from "./ChatWorkspace";
import type { GatewayClient } from "@/lib/gatewayClient";

let container: HTMLDivElement;
let root: Root;

function snapshot(): ChatSnapshot {
  return {
    ...createInitialChatState(""),
    connection: "open",
    retrying: false,
    reconnectAttempt: 0,
  };
}

function renderWorkspace() {
  return (
    <ChatWorkspace
      profile=""
      snapshot={snapshot()}
      gateway={null as unknown as GatewayClient}
      controller={null}
      draft=""
      scopeKey="scope-a"
      onDraftChange={() => {}}
      workspaceCwd=""
      onWorkspaceChange={() => {}}
      activeStoredId={null}
      onSelectSession={() => {}}
      onNewSession={() => {}}
      onReopen={() => {}}
      sessionsRefreshKey={0}
      onSessionsRefresh={() => {}}
    />
  );
}

beforeEach(() => {
  viewport.narrow = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as { visualViewport?: unknown }).visualViewport;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
});

describe("ChatWorkspace layout", () => {
  it("shows the conversation rail and composer on desktop", async () => {
    await act(async () => {
      root.render(renderWorkspace());
    });
    expect(container.querySelector('[data-testid="chat-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-session-rail"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-composer"]')).not.toBeNull();
    expect(container.textContent).toContain("How can I help?");
  });

  it("turns the rail into a drawer at narrow widths", async () => {
    viewport.narrow = true;
    await act(async () => {
      root.render(renderWorkspace());
    });
    expect(container.querySelector('[data-testid="chat-session-rail"]')).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-chat-action="toggle-rail"]',
    );
    await act(async () => {
      toggle?.click();
    });
    expect(container.querySelector('[data-testid="chat-session-rail"]')).not.toBeNull();

    // Escape closes the drawer and restores focus.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector('[data-testid="chat-session-rail"]')).toBeNull();
  });

  it("lifts the composer above a mobile keyboard inset", async () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 500,
        offsetTop: 0,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    await act(async () => {
      root.render(renderWorkspace());
    });
    const workspace = container.querySelector<HTMLElement>(
      '[data-testid="chat-workspace"]',
    );
    expect(workspace?.style.paddingBottom).toBe("400px");
  });

  it("opens the details drawer from the header", async () => {
    await act(async () => {
      root.render(renderWorkspace());
    });
    expect(container.querySelector('[data-testid="chat-details"]')).toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-chat-action="details"]')
        ?.click();
    });
    expect(container.querySelector('[data-testid="chat-details"]')).not.toBeNull();
  });
});
