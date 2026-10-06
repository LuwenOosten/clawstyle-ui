import { expect, it } from "vitest";

import { TERMINAL_FONT_FAMILY } from "./terminal-font";

it("uses a system monospace stack with no bundled webfont", () => {
  expect(TERMINAL_FONT_FAMILY).not.toMatch(/JetBrains/i);
  expect(TERMINAL_FONT_FAMILY).toMatch(/monospace\s*$/);
});
