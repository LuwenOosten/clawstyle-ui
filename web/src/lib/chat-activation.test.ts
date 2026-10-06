import { describe, expect, it } from "vitest";

import { latchChatActivation } from "./chat-activation";

describe("latchChatActivation", () => {
  it("activates on the first visit", () => {
    expect(latchChatActivation(false, true)).toBe(true);
  });

  it("stays active after leaving chat", () => {
    expect(latchChatActivation(true, false)).toBe(true);
  });

  it("does not activate while other routes are shown", () => {
    expect(latchChatActivation(false, false)).toBe(false);
  });
});
