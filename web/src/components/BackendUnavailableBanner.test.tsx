// @vitest-environment jsdom
// Tests for the app-shell backend diagnostic banner. A failed sidebar status
// poll must surface an actionable message (start the backend / check
// HERMES_DASHBOARD_URL) instead of leaving the shell silently loading.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { I18nProvider } from "@/i18n";
import { BackendUnavailableBanner } from "./BackendUnavailableBanner";

let container: HTMLDivElement;
let root: Root;

async function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<I18nProvider>{ui}</I18nProvider>));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

function banner(): HTMLElement | null {
  return container.querySelector('[data-testid="backend-unavailable-banner"]');
}

describe("BackendUnavailableBanner", () => {
  it("renders nothing while the backend is reachable", async () => {
    await render(<BackendUnavailableBanner onRetry={() => {}} unreachable={false} />);
    expect(banner()).toBeNull();
  });

  it("explains how to fix an unreachable backend and shows the raw detail", async () => {
    await render(
      <BackendUnavailableBanner
        detail="Hermes dashboard cannot reach the Hermes service."
        onRetry={() => {}}
        unreachable
      />,
    );
    const el = banner();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("Cannot reach the Hermes Agent backend.");
    expect(el!.textContent).toContain("hermes dashboard");
    expect(el!.textContent).toContain("HERMES_DASHBOARD_URL");
    expect(el!.textContent).toContain(
      "Hermes dashboard cannot reach the Hermes service.",
    );
  });

  it("calls the retry action", async () => {
    const onRetry = vi.fn();
    await render(<BackendUnavailableBanner onRetry={onRetry} unreachable />);
    const button = Array.from(banner()!.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Retry now"),
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
