import { parseColor, THEME_PRESET_PALETTES, type ThemePresetPalette } from "@hermes/shared";
import type { DashboardTheme, ThemePalette, ThemeTypography, ThemeLayout } from "./types";

/**
 * Built-in dashboard themes.
 *
 * Each theme defines its own palette, typography, and layout so switching
 * themes produces visible changes beyond just color — fonts, density, and
 * corner-radius all shift to match the theme's personality.
 *
 * Theme names must stay in sync with the backend's
 * `_BUILTIN_DASHBOARD_THEMES` list in `hermes_cli/web_server.py`.
 *
 * Presets that also ship on the desktop (midnight, ember, mono, cyberpunk)
 * take their colours from `@hermes/shared` `THEME_PRESET_PALETTES` so both
 * surfaces render one palette; only typography/layout/overrides live here.
 */

// ---------------------------------------------------------------------------
// Shared typography / layout presets
// ---------------------------------------------------------------------------

/**
 * CJK fallbacks appended to the Latin-first stacks so Chinese/Japanese/Korean
 * text is rendered by a real glyph source instead of tofu when the primary
 * stack has no CJK coverage. The generic family stays last: a missing webfont
 * (or a blocked Google Fonts request) still resolves to the OS default.
 */
const CJK_SANS_FALLBACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
const CJK_MONO_FALLBACK =
  '"Sarasa Mono SC", "Noto Sans Mono CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", monospace';

/** Default system stack — neutral, readable sans for every platform. */
const SYSTEM_SANS = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, ${CJK_SANS_FALLBACK}`;
const SYSTEM_MONO = `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", ${CJK_MONO_FALLBACK}`;

const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  baseSize: "15px",
  lineHeight: "1.55",
  letterSpacing: "0",
};

/**
 * OpenClaw typography — the readable counterpart to the brand display faces.
 *
 * The upstream dashboard sets headings, labels and chrome in decorative
 * display fonts (Rules Expanded / Mondwest) and code in a Courier-ish face.
 * OpenClaw keeps the structure but renders text in a neutral system sans with
 * explicit CJK fallbacks, and code/ids in a real monospace stack whose last
 * entries are OS fonts, so a failed webfont fetch never blocks legibility.
 */
const OPENCLAW_TYPOGRAPHY: ThemeTypography = {
  fontSans: SYSTEM_SANS,
  fontMono: SYSTEM_MONO,
  baseSize: "15px",
  lineHeight: "1.6",
  letterSpacing: "0",
};

const DEFAULT_LAYOUT: ThemeLayout = {
  radius: "0.5rem",
  density: "comfortable",
};

/**
 * Project a shared (desktop-shaped) preset palette onto the dashboard's
 * 3-slot model. The dashboard's `midground` is its text + primary-fill
 * colour, which is the desktop's `primary`; its `warmGlow` is the brand
 * accent stroke, which is the desktop's `midground` (falling back to `ring`).
 * `foreground` stays the dashboard's invisible white overlay. Dark palettes
 * are the dashboard's home turf, so a preset shipping `darkColors` is read
 * from that side.
 */
export function webPresetFromShared(
  preset: ThemePresetPalette,
): Omit<ThemePalette, "noiseOpacity"> {
  const colors = preset.darkColors ?? preset.colors;
  const [r, g, b] = parseColor(colors.midground ?? colors.ring) ?? [255, 255, 255];
  return {
    background: { hex: colors.background, alpha: 1 },
    midground: { hex: colors.primary, alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: `rgba(${r}, ${g}, ${b}, 0.3)`,
  };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export const defaultTheme: DashboardTheme = {
  name: "default",
  label: "Hermes Teal",
  description: "Classic dark teal — the canonical Hermes look",
  palette: {
    background: { hex: "#041c1c", alpha: 1 },
    midground: { hex: "#ffe6cb", alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: "rgba(255, 189, 56, 0.35)",
    noiseOpacity: 1,
  },
  typography: DEFAULT_TYPOGRAPHY,
  layout: DEFAULT_LAYOUT,
  terminalBackground: "#000000",
};

export const midnightTheme: DashboardTheme = {
  name: "midnight",
  label: "Midnight",
  description: "Deep blue-violet with cool accents",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.midnight),
    noiseOpacity: 0.8,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Inter", ${SYSTEM_SANS}`,
    fontMono: `"JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap",
    letterSpacing: "-0.005em",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0.75rem",
  },
};

export const emberTheme: DashboardTheme = {
  name: "ember",
  label: "Ember",
  description: "Warm crimson and bronze — forge vibes",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.ember),
    noiseOpacity: 1,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Spectral", Georgia, "Times New Roman", serif`,
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0.25rem",
  },
  colorOverrides: {
    destructive: "#c92d0f",
    warning: "#f97316",
  },
};

export const monoTheme: DashboardTheme = {
  name: "mono",
  label: "Mono",
  description: "Clean grayscale — minimal and focused",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.mono),
    noiseOpacity: 0.6,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"IBM Plex Sans", ${SYSTEM_SANS}`,
    fontMono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0",
  },
};

export const cyberpunkTheme: DashboardTheme = {
  name: "cyberpunk",
  label: "Cyberpunk",
  description: "Neon green on black — matrix terminal",
  palette: {
    ...webPresetFromShared(THEME_PRESET_PALETTES.cyberpunk),
    noiseOpacity: 1.2,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Share Tech Mono", "JetBrains Mono", ${SYSTEM_MONO}`,
    fontMono: `"Share Tech Mono", "JetBrains Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=JetBrains+Mono:wght@400;700&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0",
  },
  colorOverrides: {
    success: "#00ff88",
    warning: "#ffd700",
    destructive: "#ff0055",
  },
};

export const roseTheme: DashboardTheme = {
  name: "rose",
  label: "Rosé",
  description: "Soft pink and warm ivory — easy on the eyes",
  palette: {
    background: { hex: "#1a0f15", alpha: 1 },
    midground: { hex: "#ffd4e1", alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: "rgba(249, 168, 212, 0.3)",
    noiseOpacity: 0.9,
  },
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontSans: `"Fraunces", Georgia, serif`,
    fontMono: `"DM Mono", ${SYSTEM_MONO}`,
    fontUrl:
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Mono:wght@400;500&display=swap",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "1rem",
  },
};

/** Light mode — vivid Nous-blue accents on a cream canvas. */
export const nousBlueTheme: DashboardTheme = {
  name: "nous-blue",
  label: "Nous Blue",
  description: "Light mode — vivid Nous-blue accents on cream canvas",
  palette: {
    background: { hex: "#E8F2FD", alpha: 1 },
    midground: { hex: "#0053FD", alpha: 1 },
    foreground: { hex: "#170d02", alpha: 0 },
    warmGlow: "rgba(0, 83, 253, 0.12)",
    noiseOpacity: 0,
  },
  typography: DEFAULT_TYPOGRAPHY,
  layout: DEFAULT_LAYOUT,
  terminalBackground: "#f5f8fc",
  terminalForeground: "#170d02",
  seriesColors: {
    inputTokenAccent: "#001934",
    outputTokenAccent: "#0053fd",
  },
  swatchColors: ["#170d02", "#0053FD", "#E8F2FD"],
};

/**
 * OpenClaw — charcoal surfaces with a coral signature accent.
 *
 * Colour roles follow the OpenClaw design system (`ui/src/styles/base.css`):
 * canvas `#0e1015`, sidebar `#13151b`, card `#161920`, popover `#191c24`,
 * hover `#1f2330`, body `#bcbcc0`, headings `#f4f4f5`, coral ink `#ff5c5c`
 * and the contrast-safe filled primary `#d13c3c` (white ink). Status colours
 * stay independent from the brand accent so success/warning/error can never
 * be read as emphasis. The selector-level rules that the token layer cannot
 * reach live in `web/src/themes/openclaw.css` (gated on the
 * `data-dashboard-theme` attribute this theme name produces).
 *
 * `terminalBackground`/`terminalForeground` and `seriesColors` are consumed
 * by the frontend definition only — the server-side YAML registration in
 * `theme/dashboard-themes/openclaw.yaml` exists to make the name known to
 * the themes API, and `_normalise_theme_definition` intentionally drops
 * those fields.
 */
export const openclawTheme: DashboardTheme = {
  name: "openclaw",
  label: "OpenClaw",
  description: "Charcoal surfaces with a coral accent",
  palette: {
    background: { hex: "#0e1015", alpha: 1 },
    midground: { hex: "#f4f4f5", alpha: 1 },
    foreground: { hex: "#ffffff", alpha: 0 },
    warmGlow: "rgba(255, 92, 92, 0.2)",
    noiseOpacity: 0,
  },
  typography: OPENCLAW_TYPOGRAPHY,
  layout: {
    ...DEFAULT_LAYOUT,
    radius: "0.625rem",
  },
  componentStyles: {
    card: { background: "#161920" },
    sidebar: { background: "#13151b" },
  },
  // Opt in to the `--theme-color-*` slots consumed by index.css. Legacy
  // themes keep writing the historical `--color-*` names only.
  runtimeColorTokens: true,
  colorOverrides: {
    card: "#161920",
    cardForeground: "#f4f4f5",
    popover: "#191c24",
    popoverForeground: "#f4f4f5",
    primary: "#d13c3c",
    primaryForeground: "#ffffff",
    secondary: "#161920",
    secondaryForeground: "#f4f4f5",
    muted: "#1f2330",
    mutedForeground: "#bcbcc0",
    accent: "#1f2330",
    accentForeground: "#f4f4f5",
    // Fill and ink are one contrast decision (#fafafa on #d32f2f ≈ 4.8:1);
    // error *text* uses the brighter OpenClaw `--danger` ink via textDanger.
    destructive: "#d32f2f",
    destructiveForeground: "#fafafa",
    success: "#22c55e",
    warning: "#f59e0b",
    border: "#1e2028",
    input: "#1e2028",
    ring: "#ff5c5c",
    textPrimary: "#f4f4f5",
    textSecondary: "#bcbcc0",
    textTertiary: "#8b8b94",
    textDisabled: "#6e6e77",
    textDanger: "#f87171",
    textAccent: "#ff5c5c",
  },
  terminalBackground: "#0e1015",
  terminalForeground: "#bcbcc0",
  seriesColors: {
    // Input reads as the coral signature; output stays teal so the two
    // series remain distinguishable without a second brand-red.
    inputTokenAccent: "#ff5c5c",
    outputTokenAccent: "#14b8a6",
  },
  swatchColors: ["#0e1015", "#f4f4f5", "#ff5c5c"],
};

/**
 * Default theme for a fresh install. The OpenClaw/ClawStyle look is the
 * point of this frontend, so it replaces the upstream Hermes Teal default
 * *without* touching an explicit preference: `ThemeProvider` keeps any
 * locally saved theme and only treats a non-default server-persisted theme
 * as an explicit choice.
 */
export const DEFAULT_THEME_NAME = "openclaw";

/**
 * Same look as ``defaultTheme`` but with a larger root font size, looser
 * line-height, and ``spacious`` density so every rem-based size in the
 * dashboard scales up. For users who find the default 15px UI too dense.
 */
export const defaultLargeTheme: DashboardTheme = {
  name: "default-large",
  label: "Hermes Teal (Large)",
  description: "Hermes Teal with bigger fonts and roomier spacing",
  palette: defaultTheme.palette,
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    baseSize: "18px",
    lineHeight: "1.65",
  },
  layout: {
    ...DEFAULT_LAYOUT,
    density: "spacious",
  },
};

export const BUILTIN_THEMES: Record<string, DashboardTheme> = {
  default: defaultTheme,
  "default-large": defaultLargeTheme,
  "nous-blue": nousBlueTheme,
  midnight: midnightTheme,
  ember: emberTheme,
  mono: monoTheme,
  cyberpunk: cyberpunkTheme,
  rose: roseTheme,
  openclaw: openclawTheme,
};
