import { describe, expect, it } from "vitest";
import { applyScopedReset } from "./config-reset";

describe("applyScopedReset", () => {
  const defaults = {
    agent: { model: "default-model", temperature: 0.5 },
    display: { theme: "default" },
  };

  it("resets only the scoped keys and preserves everything else", () => {
    const config = {
      agent: { model: "custom", temperature: 0.9, extra: true },
      display: { theme: "openclaw" },
    };
    const next = applyScopedReset(config, defaults, ["agent.model"]);
    expect(next.agent).toEqual({
      model: "default-model",
      temperature: 0.9,
      extra: true,
    });
    expect(next.display).toEqual({ theme: "openclaw" });
  });

  it("does not mutate the input object (explicit Save still owns the write)", () => {
    const config = { agent: { model: "custom" } };
    const snapshot = JSON.stringify(config);
    const next = applyScopedReset(config, defaults, ["agent.model"]);
    expect(JSON.stringify(config)).toBe(snapshot);
    expect(next).not.toBe(config);
  });

  it("handles a reset to an undefined default as an explicit undefined", () => {
    const next = applyScopedReset({}, { agent: {} }, ["agent.missing"]);
    expect("missing" in (next.agent as object)).toBe(true);
  });
});
