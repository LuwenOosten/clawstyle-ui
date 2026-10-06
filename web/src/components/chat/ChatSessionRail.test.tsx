// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiCalls = vi.hoisted(() => ({
  sessions: [] as Array<{ limit: number; offset: number }>,
}));

vi.mock("@/lib/api", () => ({
  api: {
    getSessions: async (limit: number, offset: number) => {
      apiCalls.sessions.push({ limit, offset });
      return {
        sessions: Array.from({ length: limit }, (_, index) => ({
          id: `s-${offset + index}`,
          title: `Conversation ${offset + index}`,
          started_at: 1_700_000_000,
          last_active: 1_700_000_000,
          message_count: 1,
          source: "cli",
        })),
        total: 200,
        limit,
        offset,
      };
    },
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

import { ChatSessionRail } from "./ChatSessionRail";

let container: HTMLDivElement;
let root: Root;

function renderRail() {
  return (
    <ChatSessionRail
      profile=""
      activeStoredId={null}
      refreshKey={0}
      workspaceCwd=""
      onWorkspaceChange={() => {}}
      onSelect={() => {}}
      onNew={() => {}}
    />
  );
}

beforeEach(() => {
  apiCalls.sessions.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChatSessionRail", () => {
  it("loads older conversations beyond the first page", async () => {
    await act(async () => {
      root.render(renderRail());
    });
    await vi.waitFor(() => {
      expect(apiCalls.sessions.length).toBeGreaterThan(0);
    });
    expect(apiCalls.sessions[0]).toEqual({ limit: 30, offset: 0 });

    const loadOlder = container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-session-load-older"]',
    );
    expect(loadOlder).not.toBeNull();
    await act(async () => {
      loadOlder?.click();
    });
    await vi.waitFor(() => {
      expect(apiCalls.sessions.at(-1)).toEqual({ limit: 60, offset: 0 });
    });
  });

  it("renders an owned search field with room for the icon", async () => {
    await act(async () => {
      root.render(renderRail());
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="chat-session-search"]',
    );
    expect(input).not.toBeNull();
    expect(input?.style.paddingLeft).toBe("1.75rem");
  });
});
