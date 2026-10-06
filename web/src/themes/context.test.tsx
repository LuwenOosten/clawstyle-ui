// @vitest-environment jsdom
//
// ThemeProvider contracts that the theme CSS depends on:
//   1. a frontend built-in stays selectable when the server registry has
//      not learned its name yet (the picker merges built-ins in), and its
//      full definition (terminal/series colours the server drops) wins over
//      the normalised YAML copy;
//   2. the active theme name is published as `data-dashboard-theme`, the
//      gate every theme-scoped presentation rule matches — switching away
//      rewrites it, so no OpenClaw rule can survive the switch;
//   3. only a theme that opts into `runtimeColorTokens` writes the
//      `--theme-color-*` slots consumed by the dashboard; historical themes
//      keep writing their `--color-*` names alone (no rendering change).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const apiMocks = vi.hoisted(() => ({
  getThemes: vi.fn(),
  getFontPref: vi.fn(),
  setTheme: vi.fn(async () => ({ ok: true })),
  setFontPref: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

import { ThemeProvider } from "./context";
import { useTheme } from "./context";
import { BUILTIN_THEMES } from "./presets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom does not implement `CSS.escape`, which ThemeProvider's webfont-link
// injection uses; the browser path is untouched.
if (typeof globalThis.CSS === "undefined") {
  (globalThis as { CSS?: { escape: (value: string) => string } }).CSS = {
    escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
  };
}

let container: HTMLDivElement;
let root: Root;

function Probe() {
  const { themeName, theme, availableThemes, setTheme } = useTheme();
  return (
    <div>
      <button
        data-theme-name={themeName}
        data-terminal={theme.terminalBackground}
        data-has-openclaw={
          availableThemes.some((t) => t.name === "openclaw") ? "yes" : "no"
        }
        onClick={() => setTheme("default")}
      />
      <button data-name="to-cyberpunk" onClick={() => setTheme("cyberpunk")} />
    </div>
  );
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });
  // Let the mount-time theme/font fetches settle.
  await act(async () => {});
}

function button() {
  return container.querySelector("button") as HTMLButtonElement;
}

function themedVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-dashboard-theme");
  vi.clearAllMocks();
});

describe("ThemeProvider built-in themes", () => {
  it("keeps a frontend built-in selectable when the server registry omits it", async () => {
    // Server lag: its list has not been updated for the new built-in, and
    // the persisted active theme is the new name.
    apiMocks.getThemes.mockResolvedValue({
      active: "openclaw",
      themes: [
        { name: "default", label: "Hermes Teal", description: "default" },
      ],
    });
    apiMocks.getFontPref.mockResolvedValue({ font: "theme" });

    await mount();

    expect(button().dataset.themeName).toBe("openclaw");
    expect(button().dataset.hasOpenclaw).toBe("yes");
    // The frontend definition must win: the server would have stripped the
    // terminal colours from the same-named YAML.
    expect(button().dataset.terminal).toBe(BUILTIN_THEMES.openclaw.terminalBackground);
    // OpenClaw opts into the runtime slots and keeps the historical names
    // in sync for any consumer that reads them directly.
    expect(themedVar("--theme-color-destructive")).toBe("#d32f2f");
    expect(themedVar("--theme-color-text-danger")).toBe("#f87171");
    expect(themedVar("--color-destructive")).toBe("#d32f2f");
  });

  it("keeps historical themes on the --color-* names only", async () => {
    apiMocks.getThemes.mockResolvedValue({
      active: "cyberpunk",
      themes: [{ name: "cyberpunk", label: "Cyberpunk", description: "neon" }],
    });
    apiMocks.getFontPref.mockResolvedValue({ font: "theme" });

    await mount();

    expect(button().dataset.themeName).toBe("cyberpunk");
    expect(themedVar("--color-success")).toBe("#00ff88");
    expect(themedVar("--color-destructive")).toBe("#ff0055");
    // No opt-in → the runtime indirection slots stay untouched, so the
    // rendering is exactly the pre-existing one.
    expect(themedVar("--theme-color-success")).toBe("");
    expect(themedVar("--theme-color-destructive")).toBe("");
  });

  it("scopes the active theme by attribute and drops the scope on switch", async () => {
    apiMocks.getThemes.mockResolvedValue({
      active: "openclaw",
      themes: [
        { name: "default", label: "Hermes Teal", description: "default" },
        { name: "openclaw", label: "OpenClaw", description: "coral" },
      ],
    });
    apiMocks.getFontPref.mockResolvedValue({ font: "theme" });

    await mount();

    expect(document.documentElement.dataset.dashboardTheme).toBe("openclaw");

    await act(async () => {
      button().click();
    });

    expect(button().dataset.themeName).toBe("default");
    expect(document.documentElement.dataset.dashboardTheme).toBe("default");
    expect(button().dataset.terminal).toBe(BUILTIN_THEMES.default.terminalBackground);
    // Both variable families are cleared; nothing from OpenClaw can leak.
    expect(themedVar("--theme-color-card")).toBe("");
    expect(themedVar("--color-card")).toBe("");
  });

  it("clears OpenClaw runtime slots when switching to a historical theme", async () => {
    apiMocks.getThemes.mockResolvedValue({
      active: "openclaw",
      themes: [
        { name: "cyberpunk", label: "Cyberpunk", description: "neon" },
        { name: "openclaw", label: "OpenClaw", description: "coral" },
      ],
    });
    apiMocks.getFontPref.mockResolvedValue({ font: "theme" });

    await mount();
    expect(themedVar("--theme-color-card")).toBe("#161920");

    await act(async () => {
      (
        container.querySelector("[data-name='to-cyberpunk']") as HTMLButtonElement
      ).click();
    });

    expect(button().dataset.themeName).toBe("cyberpunk");
    expect(themedVar("--theme-color-card")).toBe("");
    expect(themedVar("--color-muted")).toBe("");
  });
});

// The fork ships OpenClaw as its default look. It must not drag a user off a
// preference they already saved, and must not let the backend's untouched
// "default" (Hermes Teal) value override either the new default or a local
// choice — while a genuinely different server-persisted theme still syncs.
describe("ThemeProvider OpenClaw default", () => {
  it("defaults to OpenClaw when nothing is persisted anywhere", async () => {
    apiMocks.getThemes.mockResolvedValue({
      active: "default",
      themes: [{ name: "default", label: "Hermes Teal", description: "default" }],
    });
    apiMocks.getFontPref.mockResolvedValue({ font: "theme" });

    await mount();

    expect(button().dataset.themeName).toBe("openclaw");
    expect(document.documentElement.dataset.dashboardTheme).toBe("openclaw");
  });

  it("keeps an explicit local preference when the backend still reports its default", async () => {
    window.localStorage.setItem("hermes-dashboard-theme", "ember");
    apiMocks.getThemes.mockResolvedValue({
      active: "default",
      themes: [{ name: "default", label: "Hermes Teal", description: "default" }],
    });
    apiMocks.getFontPref.mockResolvedValue({ font: "theme" });

    await mount();

    expect(button().dataset.themeName).toBe("ember");
    expect(document.documentElement.dataset.dashboardTheme).toBe("ember");
  });

  it("still syncs a non-default theme persisted by another browser", async () => {
    window.localStorage.setItem("hermes-dashboard-theme", "ember");
    apiMocks.getThemes.mockResolvedValue({
      active: "cyberpunk",
      themes: [{ name: "cyberpunk", label: "Cyberpunk", description: "neon" }],
    });
    apiMocks.getFontPref.mockResolvedValue({ font: "theme" });

    await mount();

    expect(button().dataset.themeName).toBe("cyberpunk");
  });
});
