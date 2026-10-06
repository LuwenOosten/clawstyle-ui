// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ProfileProvider } from "@/contexts/ProfileProvider";
import { HomeRedirect, RememberPage, LAST_PAGE_KEY, homeDestination } from "./home-navigation";

vi.mock("@/lib/api", () => ({
  api: { getProfiles: () => new Promise(() => {}), getActiveProfile: () => new Promise(() => {}) },
  setManagementProfile: () => {},
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const paths = ["/", "/chat", "/sessions", "/models", "/plugin/:id"];
let root: Root;
let container: HTMLDivElement;
function Probe() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}
async function mount(entry: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[entry]}>
      <ProfileProvider>
        <RememberPage paths={paths} loading={false} />
        <Routes>
          <Route path="/" element={<HomeRedirect paths={paths} loading={false} />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </ProfileProvider>
    </MemoryRouter>,
  ));
}
beforeEach(() => {
  localStorage.clear();
  window.__HERMES_DASHBOARD_PROFILE__ = "default";
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
  delete window.__HERMES_DASHBOARD_PROFILE__;
});
function save(pathname: string, search = "") {
  localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({ pathname, search }));
}
describe("home navigation", () => {
  it("opens Chat on first entry without racing ProfileProvider's URL sync", async () => {
    await mount("/");
    expect(container.textContent).toBe("/chat?profile=default");
  });
  it("restores the last page and its profile on entry", async () => {
    save("/models", "?profile=work");
    await mount("/");
    expect(container.textContent).toBe("/models?profile=work");
  });
  it("honors explicit deep links instead of the last page", async () => {
    save("/models", "?profile=work");
    await mount("/sessions?profile=other");
    expect(container.textContent).toBe("/sessions?profile=other");
  });
  it("drops a saved conversation when explicitly entering another profile", () => {
    save("/chat", "?profile=work&resume=old");
    expect(homeDestination(paths, "?profile=other")).toEqual({ pathname: "/chat", search: "?profile=other" });
  });
  it("opens explicit conversation links in Chat", () => {
    save("/models", "?profile=work");
    expect(homeDestination(paths, "?session=new")).toEqual({ pathname: "/chat", search: "?profile=work&session=new" });
  });
  it.each(["//evil.example", "https://evil.example", "/removed", "/", "/chat#bad", "/\\evil.example"])("ignores invalid saved path %s", (pathname) => {
    save(pathname);
    expect(homeDestination(paths, "").pathname).toBe("/chat");
  });
  it("allows registered plugin routes", () => {
    save("/plugin/example");
    expect(homeDestination(paths, "").pathname).toBe("/plugin/example");
  });
  it("records route context without credentials", async () => {
    await mount("/chat?profile=work&resume=one&token=secret&code=private");
    expect(JSON.parse(localStorage.getItem(LAST_PAGE_KEY)!)).toEqual({ pathname: "/chat", search: "?profile=work&resume=one" });
  });
  it("still opens Chat when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await mount("/");
    expect(container.textContent).toBe("/chat?profile=default");
  });
  it("uses the configured fallback when Chat is unavailable", () => {
    expect(homeDestination(["/sessions"], "", "/sessions").pathname).toBe("/sessions");
  });
});
