import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";

import { ChatMessageView } from "@/components/chat/ChatMessageView";
import { ChatToolCard } from "@/components/chat/ChatToolCard";
import type { ChatMessageItem, ChatToolItem } from "@/features/chat/types";
import { useChatI18n } from "@/features/chat/useChatI18n";

function WorkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-xs text-text-tertiary" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-tertiary"
            style={{ animationDelay: `${index * 160}ms` }}
          />
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

/**
 * Centered conversation feed. Follows new output only while the user is at
 * the bottom; otherwise it keeps their scroll position and offers a
 * jump-to-latest affordance.
 */
export function ChatTranscript({
  items,
  running,
  hydrating,
  pinToBottomKey,
  onOpenToolDetails,
}: {
  items: ChatMessageItem[];
  running: boolean;
  hydrating: boolean;
  pinToBottomKey: number;
  onOpenToolDetails?: (tool: ChatToolItem) => void;
}) {
  const copy = useChatI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = true;
    setShowJump(false);
    if (smooth) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    } else {
      element.scrollTop = element.scrollHeight;
    }
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance < 48;
    stickRef.current = atBottom;
    setShowJump(!atBottom && items.length > 0);
  }, [items.length]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [items]);

  useEffect(() => {
    stickRef.current = true;
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [pinToBottomKey]);

  const showWorking =
    running &&
    !items.some((item) => item.streaming) &&
    items.length > 0;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="off"
        aria-label={copy.title}
        tabIndex={0}
        data-testid="chat-transcript"
        className="h-full overflow-y-auto overscroll-contain focus:outline-none"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-6 sm:px-6">
          {hydrating && items.length === 0 ? (
            <div
              className="flex items-center justify-center gap-2 py-10 text-xs text-text-tertiary"
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{copy.hydrating}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-2 py-16 text-center">
              <h2 className="text-xl font-semibold text-foreground">{copy.emptyTitle}</h2>
              <p className="max-w-[34rem] text-sm leading-relaxed text-text-secondary">
                {copy.emptyBody}
              </p>
            </div>
          ) : (
            items.map((item) =>
              item.kind === "tool" && item.tool ? (
                <ChatToolCard
                  key={item.id}
                  tool={item.tool}
                  onOpenDetails={onOpenToolDetails}
                />
              ) : (
                <ChatMessageView key={item.id} item={item} />
              ),
            )
          )}
          {showWorking ? <WorkingIndicator label={copy.thinking} /> : null}
        </div>
      </div>

      {showJump ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-text-secondary shadow-md transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/60"
            data-testid="chat-jump-latest"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {copy.jumpToLatest}
          </button>
        </div>
      ) : null}
    </div>
  );
}
