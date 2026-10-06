import { contrastRatio, THEME_PRESET_PALETTES, type ThemePresetPalette } from "@hermes/shared";
import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES, webPresetFromShared } from "./presets";

// Every preset the dashboard shares with the desktop must render the shared
// table's palette, not a private copy — that is the whole point of the table.
// The second assertion keeps the projection honest: whatever slot the mapping
// picks as the dashboard's text/primary colour has to stay legible on the
// canvas it picks, so a future re-mapping cannot silently ship grey-on-grey.
describe("dashboard presets derive from the shared palette table", () => {
  const shared = Object.keys(BUILTIN_THEMES).filter(
    (name): name is keyof typeof THEME_PRESET_PALETTES => name in THEME_PRESET_PALETTES,
  );

  it("covers the presets both surfaces ship", () => {
    expect(shared).toEqual(expect.arrayContaining(["cyberpunk", "ember", "midnight", "mono"]));
  });

  it.each(shared)("%s: canvas equals the shared background and the accent reads on it", (name) => {
    const preset: ThemePresetPalette = THEME_PRESET_PALETTES[name];
    const derived = webPresetFromShared(preset);
    const palette = BUILTIN_THEMES[name].palette;

    expect(palette.background.hex).toBe((preset.darkColors ?? preset.colors).background);
    expect(palette.midground.hex).toBe(derived.midground.hex);
    expect(contrastRatio(palette.midground.hex, palette.background.hex)).toBeGreaterThanOrEqual(3);
  });
});

// The OpenClaw theme's whole point is a quiet surface ladder (canvas ->
// sidebar -> card -> popover -> hover) carrying readable text. These are
// behaviour contracts, not a colour snapshot: the ladder must stay ordered
// and every text/ink pair the theme declares must clear its WCAG target.
describe("openclaw theme keeps the OpenClaw contrast contract", () => {
  const theme = BUILTIN_THEMES.openclaw;
  const canvas = theme.palette.background.hex;
  const overrides = theme.colorOverrides ?? {};
  const required = (value: string | undefined): string => {
    expect(value).toBeTypeOf("string");
    return value as string;
  };
  /** `contrastRatio` returns null on unparseable input; tests want a number. */
  const ratio = (a: string, b: string): number => {
    const value = contrastRatio(a, b);
    expect(value).not.toBeNull();
    return value as number;
  };

  it("orders the surface ladder from the deepest canvas upward", () => {
    const surfaces = [
      canvas,
      required(theme.componentStyles?.sidebar?.background),
      required(overrides.card),
      required(overrides.popover),
      required(overrides.muted),
    ];
    for (let i = 1; i < surfaces.length; i += 1) {
      expect(ratio(surfaces[i], canvas)).toBeGreaterThan(
        ratio(surfaces[i - 1], canvas),
      );
    }
  });

  it("keeps body, strong and muted text readable on the canvas", () => {
    const body = ratio(required(overrides.mutedForeground), canvas);
    const strong = ratio(theme.palette.midground.hex, canvas);
    const muted = ratio(required(overrides.textTertiary), canvas);
    expect(body).toBeGreaterThanOrEqual(4.5);
    expect(strong).toBeGreaterThan(body);
    expect(muted).toBeGreaterThanOrEqual(4.5);
    expect(muted).toBeLessThan(body);
  });

  it("gives the filled primary white ink at AA contrast", () => {
    expect(
      ratio(required(overrides.primaryForeground), required(overrides.primary)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the coral emphasis ink independent from status colours", () => {
    const accent = required(overrides.textAccent);
    expect(ratio(accent, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(accent).not.toBe(required(overrides.primary));
    for (const status of [
      required(overrides.success),
      required(overrides.warning),
    ]) {
      expect(status).not.toBe(accent);
      expect(ratio(status, canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("splits the destructive fill from the error ink", () => {
    const fill = required(overrides.destructive);
    const ink = required(overrides.destructiveForeground);
    const dangerText = required(overrides.textDanger);
    const accent = required(overrides.textAccent);
    // Filled destructive button: UI-component contrast against the canvas,
    // normal-text AA for its ink.
    expect(ratio(fill, canvas)).toBeGreaterThanOrEqual(3);
    expect(ratio(ink, fill)).toBeGreaterThanOrEqual(4.5);
    // Error text stays legible on the canvas, and must not be mistaken for
    // the coral emphasis or the filled primary/destructive surface.
    expect(ratio(dangerText, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(dangerText).not.toBe(accent);
    expect(dangerText).not.toBe(fill);
  });
});
