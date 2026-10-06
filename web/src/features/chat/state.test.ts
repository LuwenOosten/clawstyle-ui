import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "@hermes/shared";

import {
  chatReducer,
  coerceText,
  createInitialChatState,
  historyToItems,
  mergeHistoryItems,
} from "./state";

const user = (text: string, rowId?: number): TranscriptMessage => ({
  role: "user",
  text,
  ...(rowId ? { row_id: rowId } : {}),
});

const assistant = (text: string, rowId?: number): TranscriptMessage => ({
  role: "assistant",
  text,
  ...(rowId ? { row_id: rowId } : {}),
});

describe("coerceText", () => {
  it("handles strings, parts arrays and text objects", () => {
    expect(coerceText("hello")).toBe("hello");
    expect(coerceText([{ type: "text", text: "a" }, "b"])).toBe("a\nb");
    expect(coerceText({ text: "c" })).toBe("c");
    expect(coerceText(null)).toBe("");
  });
});

describe("historyToItems", () => {
  it("projects user, assistant and tool rows", () => {
    const items = historyToItems([
      user("hi", 1),
      assistant("hello", 2),
      {
        role: "tool",
        name: "read_file",
        context: "read file.ts",
        args: { path: "file.ts" },
        tool_call_id: "tc-1",
      },
    ]);
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "tool"]);
    expect(items[0].rowId).toBe(1);
    expect(items[2].tool?.name).toBe("read_file");
    expect(items[2].tool?.args).toEqual({ path: "file.ts" });
  });

  it("skips empty and hidden rows", () => {
    const items = historyToItems([
      { role: "assistant", text: "   " },
      { role: "user", text: "visible", display_kind: "hidden" },
    ]);
    expect(items.map((item) => item.text)).toEqual(["visible"]);
  });
});

describe("mergeHistoryItems", () => {
  it("does not duplicate a streamed assistant reply that persists with the same suffix", () => {
    const live = [
      { id: "live", kind: "assistant" as const, text: "Hello world" },
    ];
    const merged = mergeHistoryItems(live, [
      { id: "row:9", kind: "assistant", text: "Hello world", rowId: 9 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].rowId).toBe(9);
  });

  it("appends rows that never streamed (another client's turn)", () => {
    const merged = mergeHistoryItems(
      [],
      historyToItems([user("from elsewhere", 3), assistant("answer", 4)]),
    );
    expect(merged.map((item) => item.text)).toEqual(["from elsewhere", "answer"]);
  });

  it("matches tools by identity rather than duplicating", () => {
    const live = [
      {
        id: "tool:tc-1",
        kind: "tool" as const,
        text: "",
        tool: { id: "tc-1", name: "read_file", status: "complete" as const },
      },
    ];
    const merged = mergeHistoryItems(live, historyToItems([
      { role: "tool", name: "read_file", tool_call_id: "tc-1" },
    ]));
    expect(merged).toHaveLength(1);
  });
});

describe("chatReducer streaming", () => {
  it("streams deltas into one segment and merges the final text", () => {
    let state = createInitialChatState("");
    state = chatReducer(state, { type: "turn/start" });
    state = chatReducer(state, { type: "assistant/delta", text: "Hel" });
    state = chatReducer(state, { type: "assistant/delta", text: "lo" });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].text).toBe("Hello");
    expect(state.items[0].streaming).toBe(true);
    state = chatReducer(state, {
      type: "turn/complete",
      payload: { text: "Hello there", status: "complete" },
    });
    expect(state.items[0].text).toBe("Hello there");
    expect(state.items[0].streaming).toBe(false);
    expect(state.running).toBe(false);
  });

  it("seals the segment when a tool starts and opens a new one after", () => {
    let state = createInitialChatState("");
    state = chatReducer(state, { type: "assistant/delta", text: "before" });
    state = chatReducer(state, {
      type: "tool/start",
      tool: { id: "t1", name: "read_file", status: "running" },
    });
    state = chatReducer(state, { type: "assistant/delta", text: "after" });
    state = chatReducer(state, {
      type: "tool/complete",
      toolId: "t1",
      patch: { summary: "ok" },
    });
    expect(state.items.map((item) => item.kind)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(state.items[1].tool?.status).toBe("complete");
    expect(state.items[1].tool?.summary).toBe("ok");
    expect(state.items[0].streaming).toBe(false);
  });

  it("records a terminal error and drops the empty bubble", () => {
    let state = createInitialChatState("");
    state = chatReducer(state, { type: "turn/start" });
    state = chatReducer(state, {
      type: "turn/complete",
      payload: { status: "error", error: "provider exploded" },
    });
    expect(state.items).toHaveLength(0);
    expect(state.error).toBe("provider exploded");
    expect(state.running).toBe(false);
  });

  it("interim commentary becomes its own segment", () => {
    let state = createInitialChatState("");
    state = chatReducer(state, { type: "assistant/delta", text: "one" });
    state = chatReducer(state, { type: "assistant/interim", text: "note" });
    state = chatReducer(state, { type: "assistant/delta", text: "two" });
    expect(state.items.map((item) => item.text)).toEqual(["one", "note", "two"]);
  });
});

describe("chatReducer session snapshots", () => {
  it("replaces history and layers the inflight turn", () => {
    let state = createInitialChatState("work");
    state = chatReducer(state, {
      type: "session/snapshot",
      storedSessionId: "stored-1",
      runtimeSessionId: "runtime-1",
      messages: [user("old", 1), assistant("reply", 2)],
      inflight: { user: "new question", assistant: "partial", streaming: true },
      running: true,
      replaceItems: true,
    });
    expect(state.items.map((item) => item.text)).toEqual([
      "old",
      "reply",
      "new question",
      "partial",
    ]);
    expect(state.running).toBe(true);
    expect(state.items[3].streaming).toBe(true);
  });

  it("does not re-append an inflight user message already in history", () => {
    let state = createInitialChatState();
    state = chatReducer(state, {
      type: "session/snapshot",
      messages: [user("same")],
      inflight: { user: "same" },
      replaceItems: true,
    });
    expect(state.items.filter((item) => item.kind === "user")).toHaveLength(1);
  });

  it("scope/reset drops transcript and requests", () => {
    let state = createInitialChatState("a");
    state = chatReducer(state, {
      type: "request/add",
      request: {
        id: "r1",
        method: "approval",
        params: { session_id: "s", request_id: "r1" },
      },
    });
    state = chatReducer(state, { type: "scope/reset", profile: "b" });
    expect(state.requests).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.profile).toBe("b");
  });

  it("session/ended keeps the transcript and clears the runtime id", () => {
    let state = createInitialChatState();
    state = chatReducer(state, {
      type: "session/snapshot",
      runtimeSessionId: "rt",
      storedSessionId: "st",
      messages: [assistant("kept")],
      replaceItems: true,
    });
    state = chatReducer(state, { type: "session/ended", reason: "gone" });
    expect(state.sessionEnded).toBe(true);
    expect(state.runtimeSessionId).toBeNull();
    expect(state.items.some((item) => item.text === "kept")).toBe(true);
  });
});
