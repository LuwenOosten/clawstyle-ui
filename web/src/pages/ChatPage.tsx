import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { useProfileScope } from "@/contexts/useProfileScope";
import { useChatController, useChatDraft } from "@/features/chat/useChatController";
import { createInitialChatState } from "@/features/chat/state";
import { clearDraft } from "@/features/chat/drafts";
import {
  readStoredWorkspace,
  writeStoredWorkspace,
} from "@/lib/chat-workspaces";
import { copyTextToClipboard } from "@/lib/clipboard";

/**
 * `/chat` — native browser conversation.
 *
 * Wiring only: the controller owns the gateway session and transcript, the
 * workspace components render it. Nothing here opens a PTY, and no session is
 * created until the user sends the first message. When mounted persistently by
 * `App`, `isActive === false` freezes the scope so navigating other admin
 * routes cannot reset the conversation.
 */
export default function ChatPage({ isActive = true }: { isActive?: boolean }) {
  const { profile } = useProfileScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeResume = searchParams.get("resume") ?? searchParams.get("session");

  // Freeze the chat scope while the host is hidden on another route: those
  // routes have their own search params and must not reset this pane.
  const [frozenResume, setFrozenResume] = useState<string | null>(routeResume);
  // Remember the last EXPLICIT selection per profile so returning from another
  // admin route (sidebar "Chat" → /chat with no resume param) reopens the
  // conversation that was on screen. "New chat" stores null, which is how an
  // intentional fresh pane stays fresh.
  const [lastSelection, setLastSelection] = useState<Record<string, string | null>>({});
  useEffect(() => {
    // Sync the frozen scope when the pane is active; the effect only runs on
    // an active/route change, so this is a scope reset, not render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isActive) setFrozenResume(routeResume);
  }, [isActive, routeResume]);
  useEffect(() => {
    if (!isActive || !routeResume) return;
    // Remembering the explicit selection is external bookkeeping (survives
    // admin navigation); it intentionally writes state after the route change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastSelection((previous) =>
      previous[profile] === routeResume
        ? previous
        : { ...previous, [profile]: routeResume },
    );
  }, [isActive, profile, routeResume]);
  const rememberedResume = lastSelection[profile] ?? null;
  const resumeParam = isActive
    ? (routeResume ?? rememberedResume)
    : frozenResume;

  const { draft, setDraft } = useChatDraft(profile, resumeParam ?? "new");
  // Pane identity for composer-scoped state (attachments, stale restores).
  // It advances on explicit session switches/new-chat, but NOT when a fresh
  // pane merely receives its stored id after create.
  const [paneKey, setPaneKey] = useState(0);
  const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0);
  const [workspaceCwd, setWorkspaceCwdState] = useState(() =>
    readStoredWorkspace(profile),
  );
  const [workspaceProfile, setWorkspaceProfile] = useState(profile);
  if (workspaceProfile !== profile) {
    setWorkspaceProfile(profile);
    setWorkspaceCwdState(readStoredWorkspace(profile));
  }

  const lastAssistantRef = useRef("");
  const copyLast = useCallback(() => {
    if (lastAssistantRef.current) {
      void copyTextToClipboard(lastAssistantRef.current);
    }
  }, []);

  const { controller, snapshot, gateway } = useChatController(
    profile,
    resumeParam,
    {
      onPrefill: (text) => setDraft(text),
      onSessionsChanged: () => setSessionsRefreshKey((key) => key + 1),
      onCopyLast: copyLast,
    },
    isActive,
  );

  const lastAssistantText = useMemo(() => {
    const items = snapshot?.items ?? [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "assistant" && item.text.trim()) return item.text;
    }
    return "";
  }, [snapshot?.items]);
  useEffect(() => {
    lastAssistantRef.current = lastAssistantText;
  }, [lastAssistantText]);

  useEffect(() => {
    controller?.setWorkspaceCwd(workspaceCwd);
  }, [controller, workspaceCwd]);

  const storedSessionId = snapshot?.storedSessionId ?? null;

  // Reflect a freshly created session in the URL (preserving other params).
  // Only reacts to a CHANGE of the controller's stored id, so a user selecting
  // another row is never bounced back to the previous id.
  const lastSyncedStoredIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isActive || !snapshot) return;
    if (!storedSessionId) {
      lastSyncedStoredIdRef.current = null;
      return;
    }
    if (lastSyncedStoredIdRef.current === storedSessionId) return;
    lastSyncedStoredIdRef.current = storedSessionId;
    if (storedSessionId === routeResume) return;
    const next = new URLSearchParams(searchParams);
    next.set("resume", storedSessionId);
    setSearchParams(next, { replace: true });
  }, [
    isActive,
    routeResume,
    searchParams,
    setSearchParams,
    snapshot,
    storedSessionId,
  ]);

  // Returning from another admin route restores the remembered conversation's
  // URL so a reload keeps it too.
  useEffect(() => {
    if (!isActive || routeResume || !rememberedResume) return;
    const next = new URLSearchParams(searchParams);
    next.set("resume", rememberedResume);
    setSearchParams(next, { replace: true });
  }, [isActive, rememberedResume, routeResume, searchParams, setSearchParams]);

  const onWorkspaceChange = useCallback(
    (cwd: string) => {
      writeStoredWorkspace(profile, cwd);
      setWorkspaceCwdState(cwd);
    },
    [profile],
  );

  const onSelectSession = useCallback(
    (storedId: string) => {
      if (storedId === routeResume && controller) {
        // Re-selecting the visible row is a no-op rather than a re-resume.
        return;
      }
      setPaneKey((key) => key + 1);
      const next = new URLSearchParams(searchParams);
      next.set("resume", storedId);
      setSearchParams(next, { replace: true });
    },
    [controller, routeResume, searchParams, setSearchParams],
  );

  const onNewSession = useCallback(() => {
    setPaneKey((key) => key + 1);
    setLastSelection((previous) => ({ ...previous, [profile]: null }));
    controller?.newSession();
    // A fresh pane starts with its own empty draft; the previous
    // conversation's draft must survive untouched.
    clearDraft(profile, "new");
    const next = new URLSearchParams(searchParams);
    next.delete("resume");
    next.delete("session");
    setSearchParams(next, { replace: true });
    lastSyncedStoredIdRef.current = null;
  }, [controller, profile, searchParams, setSearchParams]);

  const onReopen = useCallback(() => {
    if (storedSessionId) void controller?.openSession(storedSessionId);
  }, [controller, storedSessionId]);

  const onSessionsRefresh = useCallback(() => {
    setSessionsRefreshKey((key) => key + 1);
  }, []);

  return (
    <ChatWorkspace
      profile={profile}
      snapshot={
        snapshot ?? {
          ...createInitialChatState(profile),
          connection: "idle",
          retrying: false,
          reconnectAttempt: 0,
        }
      }
      gateway={gateway}
      controller={controller}
      draft={draft}
      scopeKey={`${profile}\u0000${paneKey}`}
      onDraftChange={setDraft}
      workspaceCwd={workspaceCwd}
      onWorkspaceChange={onWorkspaceChange}
      activeStoredId={storedSessionId ?? resumeParam}
      onSelectSession={onSelectSession}
      onNewSession={onNewSession}
      onReopen={onReopen}
      sessionsRefreshKey={sessionsRefreshKey}
      onSessionsRefresh={onSessionsRefresh}
    />
  );
}
