import { describe, expect, it } from "vitest";

import { chatReducer, createInitialChatState, historyToItems, mergeHistoryItems } from "./state";

describe("chat transcript review regressions", () => {
  it("keeps a previous answer when the next turn completes without streaming deltas", () => {
    let state = chatReducer(createInitialChatState("default"), {
      type: "history/replace",
      messages: [{ role: "user", text: "first" }, { role: "assistant", text: "first answer" }],
    });
    state = chatReducer(state, { type: "user/append", id: "second-user", text: "second" });
    state = chatReducer(state, { type: "turn/start" });
    state = chatReducer(state, { type: "turn/complete", payload: { text: "second answer", status: "complete" } });
    expect(state.items.map((item) => item.text)).toEqual(["first", "first answer", "second", "second answer"]);
  });

  it("continues the restored inflight assistant in one message", () => {
    let state = chatReducer(createInitialChatState("default"), {
      type: "session/snapshot",
      messages: [{ role: "user", text: "question" }],
      inflight: { user: "question", assistant: "Hel", streaming: true },
      running: true,
      replaceItems: true,
    });
    state = chatReducer(state, { type: "assistant/delta", text: "lo" });
    expect(state.items.filter((item) => item.kind === "assistant").map((item) => item.text)).toEqual(["Hello"]);
  });

  it("does not collapse equal text with distinct durable row IDs", () => {
    const current = historyToItems([{ role: "user", text: "again", row_id: 1 }]);
    const incoming = historyToItems([{ role: "user", text: "again", row_id: 3 }]);
    expect(mergeHistoryItems(current, incoming).map((item) => item.rowId)).toEqual([1, 3]);
  });

  it("places missing durable history before the existing later message", () => {
    const current = historyToItems([{ role: "assistant", text: "answer", row_id: 2 }]);
    const incoming = historyToItems([{ role: "user", text: "question", row_id: 1 }, { role: "assistant", text: "answer", row_id: 2 }]);
    expect(mergeHistoryItems(current, incoming).map((item) => item.text)).toEqual(["question", "answer"]);
  });
});
