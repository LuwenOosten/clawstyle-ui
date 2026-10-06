import { useCallback, useEffect, useMemo, useState } from "react";
import { useBelowBreakpoint } from "@nous-research/ui/hooks/use-below-breakpoint";

import { ChatApprovalCard } from "@/components/chat/ChatApprovalCard";
import { ChatClarifyCard } from "@/components/chat/ChatClarifyCard";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatDetailsDrawer } from "@/components/chat/ChatDetailsDrawer";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatSessionRail } from "@/components/chat/ChatSessionRail";
import { ChatTranscript } from "@/components/chat/ChatTranscript";
import { ModelPickerDialog } from "@/components/ModelPickerDialog";
import { Button } from "@/ui";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { computeKeyboardInset } from "@/lib/keyboard-inset";
import type { GatewayClient } from "@/lib/gatewayClient";
import type { ChatController, ChatSnapshot } from "@/features/chat/controller";
import type { ChatToolItem } from "@/features/chat/types";
import { useChatI18n } from "@/features/chat/useChatI18n";

export interface ChatWorkspaceProps {
  profile: string;
  snapshot: ChatSnapshot;
  gateway: GatewayClient;
  controller: ChatController | null;
  draft: string;
  /** Identity of the visible pane; composer state resets when it changes. */
  scopeKey: string;
  onDraftChange: (text: string) => void;
  workspaceCwd: string;
  onWorkspaceChange: (cwd: string) => void;
  activeStoredId: string | null;
  onSelectSession: (storedSessionId: string) => void;
  onNewSession: () => void;
  onReopen: () => void;
  sessionsRefreshKey: number;
  onSessionsRefresh: () => void;
}

/**
 * The native chat workspace: conversation rail, centered transcript and the
 * persistent bottom composer. Terminal-free by construction — every data
 * source is the structured gateway contract.
 */
export function ChatWorkspace({
  profile,
  snapshot,
  gateway,
  controller,
  draft,
  scopeKey,
  onDraftChange,
  workspaceCwd,
  onWorkspaceChange,
  activeStoredId,
  onSelectSession,
  onNewSession,
  onReopen,
  sessionsRefreshKey,
  onSessionsRefresh,
}: ChatWorkspaceProps) {
  const copy = useChatI18n();
  const narrow = useBelowBreakpoint(768);
  const [railOpen, setRailOpen] = useState(!narrow);
  const [railBreakpoint, setRailBreakpoint] = useState(narrow);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTool, setDetailsTool] = useState<ChatToolItem | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const mobileRailRef = useModalBehavior({
    open: narrow && railOpen,
    onClose: () => setRailOpen(false),
  });

  // Mobile soft keyboards overlay the layout viewport on iOS; lift the whole
  // workspace by the obscured height so the composer stays visible.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () =>
      setKeyboardInset(
        computeKeyboardInset(
          { height: viewport.height, offsetTop: viewport.offsetTop },
          window.innerHeight,
        ),
      );
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);

  // React's "derive state while rendering" pattern: crossing the breakpoint
  // resets the rail to its default for that layout exactly once.
  if (railBreakpoint !== narrow) {
    setRailBreakpoint(narrow);
    setRailOpen(!narrow);
  }

  const userSendKey = useMemo(
    () => snapshot.items.filter((item) => item.kind === "user").length,
    [snapshot.items],
  );

  const openToolDetails = useCallback((tool: ChatToolItem) => {
    setDetailsTool(tool);
    setDetailsOpen(true);
  }, []);

  const onSend = useCallback(
    async (text: string, files: File[]): Promise<boolean> => {
      if (files.length === 0 && /^\/(?:new|clear)(?:\s|$)/i.test(text.trim())) {
        onNewSession();
        return true;
      }
      if (!controller) return false;
      const ok = await controller.send(text, files);
      if (ok) onSessionsRefresh();
      return ok;
    },
    [controller, onNewSession, onSessionsRefresh],
  );

  const onStop = useCallback(() => {
    void controller?.interrupt();
  }, [controller]);

  const showReconnectBanner =
    snapshot.connection !== "open" &&
    snapshot.connection !== "connecting" &&
    (snapshot.connection === "closed" || snapshot.connection === "error");

  const rail = (
    <ChatSessionRail
      profile={profile}
      activeStoredId={activeStoredId}
      refreshKey={sessionsRefreshKey}
      workspaceCwd={workspaceCwd}
      onWorkspaceChange={onWorkspaceChange}
      onSelect={(storedId) => {
        onSelectSession(storedId);
        if (narrow) setRailOpen(false);
      }}
      onNew={onNewSession}
      onClose={narrow ? () => setRailOpen(false) : undefined}
    />
  );

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row"
      style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
      data-testid="chat-workspace"
    >
      {railOpen && !narrow ? (
        <div className="hidden w-[272px] shrink-0 md:block">{rail}</div>
      ) : null}

      {railOpen && narrow ? (
        <div className="fixed inset-0 z-[100] md:hidden">
          <button
            type="button"
            aria-label={copy.close}
            onClick={() => setRailOpen(false)}
            className="absolute inset-0 bg-background/70"
          />
          <div
            ref={mobileRailRef}
            role="dialog"
            aria-modal="true"
            aria-label={copy.railToggle}
            className="absolute inset-y-0 left-0 w-[300px] max-w-[85vw]"
          >
            {rail}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader
          title={snapshot.info?.title || copy.untitled}
          info={snapshot.info}
          modelAvailable={Boolean(snapshot.runtimeSessionId)}
          connection={snapshot.connection}
          sessionEnded={snapshot.sessionEnded}
          onOpenModel={() => setModelOpen(true)}
          onToggleDetails={() => {
            setDetailsTool(null);
            setDetailsOpen((open) => !open);
          }}
          onToggleRail={() => setRailOpen((open) => !open)}
          onNewChat={onNewSession}
          onReopen={onReopen}
        />

        <ChatTranscript
          items={snapshot.items}
          running={snapshot.running}
          hydrating={snapshot.hydrating}
          pinToBottomKey={userSendKey}
          onOpenToolDetails={openToolDetails}
        />

        <div className="shrink-0 border-t border-border/60 bg-background/85">
          {showReconnectBanner ? (
            <div
              role="status"
              className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-3 pt-2 text-xs text-warning sm:px-6"
            >
              <span className="min-w-0 flex-1">
                {snapshot.retrying ? copy.reconnecting : copy.connectFailed}
              </span>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => controller?.retryNow()}
              >
                {copy.reconnect}
              </Button>
            </div>
          ) : null}

          {snapshot.requests.length > 0 ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pt-3 sm:px-6">
              {snapshot.requests.map((request) =>
                request.method === "approval" ? (
                  <ChatApprovalCard
                    key={request.id}
                    request={request}
                    onRespond={(choice, options) =>
                      controller?.respondApproval(request.id, choice, options)
                    }
                  />
                ) : (
                  <ChatClarifyCard
                    key={request.id}
                    request={request}
                    onSubmit={(answers) =>
                      controller?.respondClarify(request.id, answers)
                    }
                    onSkip={() => controller?.skipClarify(request.id)}
                  />
                ),
              )}
            </div>
          ) : null}

          <ChatComposer
            draft={draft}
            scopeKey={scopeKey}
            onDraftChange={onDraftChange}
            sendPhase={snapshot.sendPhase}
            running={snapshot.running}
            disabled={snapshot.sessionEnded}
            isEmpty={snapshot.items.length === 0}
            queued={snapshot.queued}
            status={snapshot.status}
            error={snapshot.error}
            onSend={onSend}
            onStop={onStop}
          />
        </div>
      </div>

      <ChatDetailsDrawer
        open={detailsOpen}
        tool={detailsTool}
        info={snapshot.info}
        storedSessionId={snapshot.storedSessionId}
        usage={snapshot.usage}
        onClose={() => setDetailsOpen(false)}
      />

      {modelOpen && snapshot.runtimeSessionId ? (
        <ModelPickerDialog
          gw={gateway}
          sessionId={snapshot.runtimeSessionId}
          profile={profile || undefined}
          title={copy.modelPickerTitle}
          onClose={() => setModelOpen(false)}
        />
      ) : null}
    </div>
  );
}
