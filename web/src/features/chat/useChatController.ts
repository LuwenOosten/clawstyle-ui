/**
 * React glue for {@link ChatController}.
 *
 * The controller is created in an effect (not `useMemo`) so React StrictMode's
 * setup → cleanup → setup cycle disposes the first instance and builds a fresh
 * one instead of reusing a dead controller. The underlying `GatewayClient` is
 * stable per page mount and reconnects as needed.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { GatewayClient } from "@/lib/gatewayClient";

import { ChatController, type ChatSnapshot } from "./controller";
import { readDraft, writeDraft } from "./drafts";

export interface ChatCallbacks {
  onPrefill?: (text: string) => void;
  onSessionsChanged?: () => void;
  onCopyLast?: () => void;
}

export function useChatController(
  profile: string,
  resumeId: string | null,
  callbacks: ChatCallbacks,
  active = true,
) {
  const [gateway] = useState(() => new GatewayClient());
  const callbacksRef = useRef(callbacks);

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const [controller, setController] = useState<ChatController | null>(null);
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);

  useEffect(() => {
    const instance = new ChatController({
      transport: gateway,
      profile,
      onPrefill: (text) => callbacksRef.current.onPrefill?.(text),
      onSessionsChanged: () => callbacksRef.current.onSessionsChanged?.(),
      onCopyLast: () => callbacksRef.current.onCopyLast?.(),
    });
    setController(instance);
    const unsubscribe = instance.subscribe(setSnapshot);
    void instance.connect();
    return () => {
      unsubscribe();
      instance.dispose();
      setController(null);
      setSnapshot(null);
    };
    // `profile` is intentionally not a dependency: scope changes are applied
    // by the effect below so a profile switch never rebuilds the socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  useEffect(() => {
    // While the host is hidden on another admin route the pane must keep its
    // current scope; only an active /chat applies the URL selection.
    if (!controller || !active) return;
    controller.setScope(profile, resumeId ?? null);
  }, [active, controller, profile, resumeId]);

  return { controller, snapshot, gateway };
}

export interface ChatDraftHandle {
  draft: string;
  setDraft: (text: string) => void;
  clearDraft: () => void;
}

/**
 * Draft storage bound to `profile` + `scope`. `setDraft` is stable and reads
 * the live scope from refs, so an in-flight submit that re-scopes the pane
 * writes to the scope that is current when the promise settles.
 */
export function useChatDraft(profile: string, scope: string): ChatDraftHandle {
  const [draft, setDraftState] = useState(() => readDraft(profile, scope));
  const profileRef = useRef(profile);
  const scopeRef = useRef(scope);

  useEffect(() => {
    profileRef.current = profile;
    scopeRef.current = scope;
    // Re-reading storage for the new scope is the point of the effect: a
    // session switch must show that session's draft, not the old one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftState(readDraft(profile, scope));
  }, [profile, scope]);

  const setDraft = useCallback((text: string) => {
    setDraftState(text);
    writeDraft(profileRef.current, scopeRef.current, text);
  }, []);

  const clearDraft = useCallback(() => {
    setDraftState("");
    writeDraft(profileRef.current, scopeRef.current, "");
  }, []);

  return { draft, setDraft, clearDraft };
}
