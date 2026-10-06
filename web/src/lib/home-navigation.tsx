import { useEffect } from "react";
import { matchPath, Navigate, useLocation } from "react-router";

export const LAST_PAGE_KEY = "hermes-dashboard-last-page";
const REMEMBERED_PARAMS = ["profile", "resume", "session"];

function allowedPath(pathname: string, paths: string[]): boolean {
  return pathname.startsWith("/") && !pathname.startsWith("//") &&
    !/[\\?#]/.test(pathname) && pathname !== "/" &&
    paths.some((path) => path !== "/" && path !== "*" && matchPath(path, pathname));
}

function safeSearch(search: string): string {
  const source = new URLSearchParams(search);
  const result = new URLSearchParams();
  for (const key of REMEMBERED_PARAMS) {
    const value = source.get(key);
    if (value !== null) result.set(key, value);
  }
  const query = result.toString();
  return query ? `?${query}` : "";
}

export function homeDestination(paths: string[], search: string, fallback = "/chat") {
  let saved: { pathname: string; search: string } | null = null;
  try {
    const value = JSON.parse(localStorage.getItem(LAST_PAGE_KEY) ?? "null");
    if (value && typeof value.pathname === "string" &&
        typeof value.search === "string" && allowedPath(value.pathname, paths)) {
      saved = value;
    }
  } catch { /* Missing, invalid or unavailable storage falls back to Chat. */ }
  const explicit = new URLSearchParams(search);
  const query = new URLSearchParams(safeSearch(saved?.search ?? ""));
  // Never resume a conversation from a different explicit profile.
  if (explicit.has("profile") && explicit.get("profile") !== query.get("profile")) {
    query.delete("resume");
    query.delete("session");
  }
  if (explicit.has("resume") || explicit.has("session")) {
    query.delete("resume");
    query.delete("session");
  }
  for (const [key, value] of explicit) query.set(key, value);
  const pathname = explicit.has("resume") || explicit.has("session")
    ? fallback : (saved?.pathname ?? fallback);
  return { pathname, search: query.size ? `?${query}` : "" };
}

interface NavigationProps { paths: string[]; loading: boolean }

export function HomeRedirect({ paths, loading, fallback = "/chat" }: NavigationProps & { fallback?: string }) {
  const { search } = useLocation();
  if (loading) return <div role="status" aria-busy="true">Loading…</div>;
  return <Navigate to={homeDestination(paths, search, fallback)} replace />;
}

export function RememberPage({ paths, loading }: NavigationProps) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (loading || !allowedPath(pathname, paths)) return;
    try {
      localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({ pathname, search: safeSearch(search) }));
    } catch { /* Navigation still works when storage is unavailable. */ }
  }, [loading, pathname, paths, search]);
  return null;
}
