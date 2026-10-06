// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIG_DRAFT_VERSION,
  clearConfigDraft,
  configDraftKey,
  readConfigDraft,
  writeConfigDraft,
} from "./config-draft";

describe("config draft store", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("scopes the key per profile so drafts never leak across profiles", () => {
    expect(configDraftKey("default")).not.toBe(configDraftKey("work"));
    expect(configDraftKey(null)).toBe(configDraftKey(""));
    expect(configDraftKey("default")).toContain("default");
  });

  it("round-trips a draft", () => {
    const key = configDraftKey("default");
    writeConfigDraft(key, {
      config: { agent: { model: "x" } },
      yamlMode: true,
      yamlText: "agent: {}",
      activeCategory: "agent",
    });
    const draft = readConfigDraft(key);
    expect(draft?.config).toEqual({ agent: { model: "x" } });
    expect(draft?.yamlMode).toBe(true);
    expect(draft?.yamlText).toBe("agent: {}");
    expect(draft?.activeCategory).toBe("agent");
    clearConfigDraft(key);
    expect(readConfigDraft(key)).toBeNull();
  });

  it("ignores expired, foreign-version and corrupt payloads", () => {
    const key = configDraftKey("default");
    window.sessionStorage.setItem(key, JSON.stringify({ version: 999, config: {} }));
    expect(readConfigDraft(key)).toBeNull();

    window.sessionStorage.setItem(
      key,
      JSON.stringify({ version: CONFIG_DRAFT_VERSION, config: {}, savedAt: 0 }),
    );
    expect(readConfigDraft(key, 10_000_000_000)).toBeNull();

    window.sessionStorage.setItem(key, "{not json");
    expect(readConfigDraft(key)).toBeNull();
  });

  it("survives storage that throws on access", () => {
    const spy = vi
      .spyOn(window, "sessionStorage", "get")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(() => writeConfigDraft("k", {
      config: {},
      yamlMode: false,
      yamlText: "",
      activeCategory: "",
    })).not.toThrow();
    expect(readConfigDraft("k")).toBeNull();
    spy.mockRestore();
  });
});
