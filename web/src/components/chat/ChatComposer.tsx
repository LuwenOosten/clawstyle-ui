import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, ImagePlus, Loader2, Square, X } from "lucide-react";

import { Button } from "@/ui";
import { cn } from "@/lib/utils";
import { imagesFromDataTransfer, isImageFile, transferMayContainImage } from "@/features/chat/files";
import type { ChatSendPhase, ChatStatusLine } from "@/features/chat/types";
import { useChatI18n } from "@/features/chat/useChatI18n";

const MAX_TEXTAREA_HEIGHT_PX = 200;

export interface ChatComposerProps {
  draft: string;
  /** Pane identity; attachments and local errors reset when it changes. */
  scopeKey: string;
  onDraftChange: (text: string) => void;
  sendPhase: ChatSendPhase;
  running: boolean;
  disabled?: boolean;
  isEmpty?: boolean;
  queued?: string | null;
  status?: ChatStatusLine | null;
  error?: string | null;
  onSend: (text: string, files: File[]) => Promise<boolean>;
  onStop: () => void;
}

/**
 * Persistent bottom composer. Enter sends, Shift+Enter adds a line, IME
 * composition is never interrupted, and the textarea grows to a bounded
 * height. The primary button becomes Stop while a turn is running.
 */
export function ChatComposer({
  draft,
  scopeKey,
  onDraftChange,
  sendPhase,
  running,
  disabled = false,
  isEmpty = false,
  queued,
  status,
  error,
  onSend,
  onStop,
}: ChatComposerProps) {
  const copy = useChatI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const scopeRef = useRef(scopeKey);
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const busy = sendPhase !== "idle";

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const next = Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT_PX);
    element.style.height = `${next}px`;
    element.style.overflowY =
      element.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  // Switching conversations must not carry attachments into the new pane.
  useEffect(() => {
    if (scopeRef.current === scopeKey) return;
    scopeRef.current = scopeKey;
    setFiles([]);
    setLocalError(null);
  }, [scopeKey]);

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter(isImageFile);
    if (images.length === 0) return;
    setLocalError(null);
    setFiles((previous) => {
      const seen = new Set(
        previous.map((file) => `${file.name}\0${file.size}\0${file.lastModified}`),
      );
      const next = [...previous];
      for (const file of images) {
        const key = `${file.name}\0${file.size}\0${file.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
      }
      return next;
    });
  }, []);

  const submit = useCallback(async () => {
    if (busy || disabled || running) return;
    const payload = draft;
    if (!payload.trim()) return;
    const submitScope = scopeRef.current;
    onDraftChange("");
    setLocalError(null);
    const ok = await onSend(payload, files);
    if (scopeRef.current !== submitScope) {
      // The visible pane changed while this request was in flight; the new
      // conversation's draft and attachments must not be touched.
      return;
    }
    if (!ok) {
      // Sending failed: restore exactly what the user had, attachments
      // included, so retrying never requires retyping.
      onDraftChange(payload);
      setLocalError(copy.draftRestored);
    } else {
      setFiles([]);
    }
    textareaRef.current?.focus({ preventScroll: true });
  }, [
    busy,
    copy.draftRestored,
    disabled,
    draft,
    files,
    onDraftChange,
    onSend,
    running,
  ]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return;
      const native = event.nativeEvent as globalThis.KeyboardEvent & {
        keyCode?: number;
      };
      if (composingRef.current || native.isComposing || native.keyCode === 229) return;
      if (event.shiftKey) return;
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = imagesFromDataTransfer(event.clipboardData);
      if (images.length === 0) return;
      event.preventDefault();
      addFiles(images);
    },
    [addFiles],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const images = imagesFromDataTransfer(event.dataTransfer);
      if (images.length > 0) addFiles(images);
    },
    [addFiles],
  );

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files ? Array.from(event.target.files) : [];
    addFiles(selected);
    event.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((previous) => previous.filter((_, i) => i !== index));
  };

  const hasText = draft.trim().length > 0;
  const canSend = !busy && !disabled && !running && hasText;
  const primaryLabel = running ? copy.stop : copy.send;

  return (
    <div className="chat-composer" data-testid="chat-composer">
      <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-6">
        {queued ? (
          <div
            className="mb-2 rounded-md border border-border/70 bg-card/60 px-3 py-1.5 text-[11px] text-text-secondary"
            role="status"
          >
            {copy.queued}: {queued}
          </div>
        ) : null}
        {status ? (
          <div
            className="mb-2 rounded-md border border-border/70 bg-card/60 px-3 py-1.5 text-[11px] text-text-secondary"
            role="status"
          >
            {status.text}
          </div>
        ) : null}
        {error ? (
          <div
            className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {localError && !error ? (
          <div
            className="mb-2 rounded-md border border-warning/50 bg-warning/5 px-3 py-1.5 text-[11px] text-warning"
            role="status"
          >
            {localError}
          </div>
        ) : null}

        {files.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="chat-attachments">
            {files.map((file, index) => (
              <span
                key={`${file.name}:${file.size}:${index}`}
                className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border/70 bg-card/70 px-2 py-0.5 text-[11px] text-text-secondary"
              >
                <span className="truncate">{file.name || "image"}</span>
                <button
                  type="button"
                  aria-label={copy.removeAttachment}
                  title={copy.removeAttachment}
                  onClick={() => removeFile(index)}
                  className="text-text-tertiary hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm transition-colors",
            dragActive ? "border-primary/70 ring-1 ring-primary/30" : "border-border",
            "focus-within:border-primary/50",
          )}
          onDragEnter={(event) => {
            if (transferMayContainImage(event.dataTransfer)) {
              event.preventDefault();
              setDragActive(true);
            }
          }}
          onDragOver={(event) => {
            if (transferMayContainImage(event.dataTransfer)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFileChange}
            data-testid="chat-file-input"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={copy.attachImage}
            title={copy.attachImage}
            onClick={() => fileInputRef.current?.click()}
            data-chat-action="attach"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>

          <label className="sr-only" htmlFor="chat-composer-input">
            {copy.placeholder}
          </label>
          <textarea
            id="chat-composer-input"
            ref={textareaRef}
            rows={1}
            value={draft}
            disabled={disabled}
            placeholder={isEmpty ? copy.placeholderNew : copy.placeholder}
            onChange={(event) => {
              setLocalError(null);
              onDraftChange(event.target.value);
            }}
            onKeyDown={onKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onPaste={onPaste}
            data-testid="chat-input"
            className={cn(
              "min-h-[2.25rem] min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-1.5",
              "text-sm leading-relaxed text-foreground placeholder:text-text-tertiary",
              "focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />

          {running && sendPhase !== "stopping" ? (
            <Button
              variant="danger"
              size="icon-sm"
              onClick={onStop}
              aria-label={primaryLabel}
              title={primaryLabel}
              data-chat-action="stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="icon-sm"
              disabled={!canSend}
              loading={busy}
              onClick={() => void submit()}
              aria-label={primaryLabel}
              title={primaryLabel}
              data-chat-action="send"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          )}
        </div>

        <div className="mt-1.5 flex min-h-[1rem] items-center justify-between gap-2 px-1 text-[11px] text-text-tertiary">
          <span>
            {files.length > 0 && !hasText
              ? copy.attachmentNeedsMessage
              : isEmpty
                ? copy.emptyHint
                : ""}
          </span>
          {busy ? (
            <span role="status">
              {sendPhase === "creating"
                ? copy.starting
                : sendPhase === "stopping"
                  ? copy.stopping
                  : copy.sending}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
