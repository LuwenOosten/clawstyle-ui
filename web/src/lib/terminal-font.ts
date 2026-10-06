/**
 * System monospace stack for the optional xterm console.
 *
 * This build does not bundle a terminal webfont: the former JetBrains Mono
 * files were removed because the snapshot had no accompanying license notice.
 * xterm renders cleanly with the operating system's monospace fonts, so no
 * font-loading/refit dance is needed.
 */
export const TERMINAL_FONT_FAMILY =
  "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace";
