// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { I18nProvider, useI18n } from "./context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Picker() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale("zh")}>{locale}</button>;
}
it("keeps the chosen language after the app unmounts and reopens", async () => {
  localStorage.clear();
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  try {
    await act(async () => root.render(<I18nProvider><Picker /></I18nProvider>));
    await act(async () => container.querySelector("button")!.click());
    expect(localStorage.getItem("hermes-locale")).toBe("zh");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<I18nProvider><Picker /></I18nProvider>));
    expect(container.textContent).toBe("zh");
    expect(document.documentElement.lang).toBe("zh");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
  }
});
