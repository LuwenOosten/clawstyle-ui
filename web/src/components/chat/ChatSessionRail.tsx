import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquarePlus, RefreshCw, Search, X } from "lucide-react";

import { ChatWorkspacePicker } from "@/components/ChatWorkspacePicker";
import { Button, TextInput } from "@/ui";
import { api, type SessionInfo } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { useChatI18n } from "@/features/chat/useChatI18n";

const RAIL_PAGE_SIZE = 30;

function rowId(row: SessionInfo & { session_id?: string }): string {
  return row.id || row.session_id || "";
}

/**
 * Compact conversation rail: search, new chat, workspace picker and the
 * session list. It never creates a session by itself — selecting a row only
 * navigates to its stored id.
 */
export function ChatSessionRail({
  profile,
  activeStoredId,
  refreshKey,
  workspaceCwd,
  onWorkspaceChange,
  onSelect,
  onNew,
  onClose,
  className,
}: {
  profile: string;
  activeStoredId: string | null;
  refreshKey: number;
  workspaceCwd: string;
  onWorkspaceChange: (cwd: string) => void;
  onSelect: (storedSessionId: string) => void;
  onNew: () => void;
  onClose?: () => void;
  className?: string;
}) {
  const copy = useChatI18n();
  const [rows, setRows] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(RAIL_PAGE_SIZE);
  const requestRef = useRef(0);

  const load = useCallback(
    async (search?: string) => {
      const token = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        if (search) {
          const response = await api.searchSessions(search, { profile });
          if (token !== requestRef.current) return;
          setRows(response.results as SessionInfo[]);
        } else {
          const response = await api.getSessions(limit, 0, {
            profile,
            order: "recent",
          });
          if (token !== requestRef.current) return;
          setRows(response.sessions);
        }
      } catch {
        if (token !== requestRef.current) return;
        setError(copy.loadSessionsFailed);
        setRows([]);
      } finally {
        if (token === requestRef.current) setLoading(false);
      }
    },
    [copy.loadSessionsFailed, limit, profile],
  );

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      void load(trimmed || undefined);
    }, trimmed ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query, refreshKey]);

  // A new profile restarts the page window (a scope reset, not render state).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLimit(RAIL_PAGE_SIZE);
  }, [profile]);

  const trimmedQuery = query.trim();
  const hasMore = !trimmedQuery && rows.length >= limit;

  return (
    <aside
      aria-label={copy.sessions}
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-r border-border/70 bg-card/30",
        className,
      )}
      data-testid="chat-session-rail"
    >
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onNew}
          data-chat-action="new-session"
          className="min-w-0 flex-1 justify-center gap-1.5"
        >
          <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{copy.newChat}</span>
        </Button>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={copy.close}
            title={copy.close}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="px-2 pb-2">
        <label className="relative block">
          <span className="sr-only">{copy.searchPlaceholder}</span>
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
          <TextInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
            data-testid="chat-session-search"
            className="w-full py-1.5 pr-2 text-xs"
            style={{ paddingLeft: "1.75rem" }}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{copy.hydrating}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-2 px-2 py-4 text-xs text-text-secondary">
            <span className="text-destructive">{error}</span>
            <Button variant="secondary" size="xs" onClick={() => void load(query.trim() || undefined)}>
              <RefreshCw className="h-3 w-3" />
              {copy.retry}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-text-tertiary">
            {query.trim() ? copy.noSearchResults : copy.noSessions}
          </p>
        ) : (
          <ul>
            {rows.map((row) => {
                  const id = rowId(row as SessionInfo & { session_id?: string });
                  if (!id) return null;
                  const active = id === activeStoredId;
                  return (
                    <li key={`${row.profile ?? profile}:${id}`}>
                      <button
                        type="button"
                        onClick={() => onSelect(id)}
                        aria-current={active ? "true" : undefined}
                        data-chat-session-id={id}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left transition-colors",
                          active
                            ? "bg-primary/10 text-foreground"
                            : "text-text-secondary hover:bg-midground/5 hover:text-foreground",
                        )}
                      >
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {row.title || copy.untitled}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-text-tertiary">
                            {row.last_active ? timeAgo(row.last_active) : ""}
                          </span>
                        </span>
                        {row.preview ? (
                          <span className="mt-0.5 block truncate text-[11px] text-text-tertiary">
                            {row.preview}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
            })}
          </ul>
        )}
        {hasMore ? (
          <div className="px-2 pb-2 pt-1">
            <Button
              variant="ghost"
              size="xs"
              block
              onClick={() => setLimit((value) => value + RAIL_PAGE_SIZE)}
              data-testid="chat-session-load-older"
            >
              {copy.loadOlder}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/60 px-2 py-2">
        <ChatWorkspacePicker
          profile={profile}
          value={workspaceCwd}
          onChange={onWorkspaceChange}
        />
      </div>
    </aside>
  );
}
