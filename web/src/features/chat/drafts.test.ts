// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDraft,
  moveDraft,
  readDraft,
  readLastSessionId,
  writeDraft,
  writeLastSessionId,
} from "./drafts";

describe("chat drafts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("scopes drafts by profile and session", () => {
    writeDraft("work", "s1", "for s1");
    writeDraft("work", "s2", "for s2");
    writeDraft("personal", "s1", "other profile");
    expect(readDraft("work", "s1")).toBe("for s1");
    expect(readDraft("work", "s2")).toBe("for s2");
    expect(readDraft("personal", "s1")).toBe("other profile");
    expect(readDraft("work", "missing")).toBe("");
  });

  it("keeps an unsaved draft under the new scope", () => {
    writeDraft("work", "new", "unsent");
    clearDraft("work", "s1");
    expect(readDraft("work", "new")).toBe("unsent");
    clearDraft("work", "new");
    expect(readDraft("work", "new")).toBe("");
  });

  it("moves a draft onto the assigned session", () => {
    writeDraft("work", "new", "carry me");
    moveDraft("work", "new", "st-9");
    expect(readDraft("work", "new")).toBe("");
    expect(readDraft("work", "st-9")).toBe("carry me");
  });

  it("remembers the last session per profile", () => {
    writeLastSessionId("work", "st-1");
    expect(readLastSessionId("work")).toBe("st-1");
    writeLastSessionId("work", null);
    expect(readLastSessionId("work")).toBeNull();
  });
});
