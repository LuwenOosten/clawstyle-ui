import { describe, expect, it } from "vitest";

import { FONT_CHOICES } from "./fonts";
import { BUILTIN_THEMES } from "./presets";

// A webfont (Google Fonts) can fail: offline machines, blocked CDNs, privacy
// extensions. None of that may leave the UI unreadable, so every shipped stack
// has to end in a generic family the OS will always provide.
const GENERIC_FAMILY = /(?:^|,)\s*(?:sans-serif|serif|monospace)\s*$/;

describe("font stacks degrade gracefully", () => {
  it.each(FONT_CHOICES.map((choice) => [choice.id, choice.stack] as const))(
    "catalog font %s ends in a generic family",
    (_id, stack) => {
      expect(stack).toMatch(GENERIC_FAMILY);
    },
  );

  it.each(
    Object.entries(BUILTIN_THEMES).map(
      ([name, theme]) => [name, theme.typography] as const,
    ),
  )("theme %s keeps generic sans and mono fallbacks", (_name, typography) => {
    expect(typography.fontSans).toMatch(GENERIC_FAMILY);
    expect(typography.fontMono).toMatch(GENERIC_FAMILY);
  });

  it("gives the OpenClaw/ClawStyle theme explicit CJK fallbacks", () => {
    const typography = BUILTIN_THEMES.openclaw.typography;
    expect(typography.fontSans).toMatch(/PingFang SC/);
    expect(typography.fontSans).toMatch(/Noto Sans CJK SC/);
    expect(typography.fontMono).toMatch(/Noto Sans Mono CJK SC|PingFang SC/);
  });
});
