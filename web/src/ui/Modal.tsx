import {
  useCallback,
  useId,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button";
import { ModalCloseContext, type ModalCloseHandle } from "./modal-close";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { cn } from "@/lib/utils";

/**
 * Shared modal frame: fixed header + scrollable body + persistent footer.
 *
 * Every long form (cron job editor, webhook subscription) uses this so the
 * save affordance stays reachable while the middle scrolls, and closing is
 * safe by default:
 * - `dirty` routes Escape / backdrop / close-button / Cancel through a
 *   discard confirmation instead of silently dropping typed values.
 * - `pending` makes the dialog uncloseable and marks it busy, so a submit
 *   in flight cannot be unmounted or double-fired.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Left-aligned footer status/error text, next to the action cluster. */
  footerStatus?: ReactNode;
  statusTone?: "muted" | "error" | "warning";
  size?: "sm" | "md" | "lg" | "xl";
  dirty?: boolean;
  pending?: boolean;
  closeLabel?: string;
  discardTitle?: string;
  discardDescription?: string;
  discardConfirmLabel?: string;
  discardCancelLabel?: string;
  className?: string;
  /** Overrides the generated title id (for stable ARIA wiring). */
  labelledBy?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  footerStatus,
  statusTone = "muted",
  size = "md",
  dirty = false,
  pending = false,
  closeLabel = "Close",
  discardTitle = "Discard changes?",
  discardDescription = "You have unsaved changes. Closing now will lose them.",
  discardConfirmLabel = "Discard",
  discardCancelLabel = "Keep editing",
  className,
  labelledBy,
}: ModalProps) {
  const generatedId = useId();
  const titleId = labelledBy ?? `ui-modal-title-${generatedId}`;
  const [discardOpen, setDiscardOpen] = useState(false);

  const requestClose = useCallback(() => {
    if (pending) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [dirty, onClose, pending]);

  const dialogRef = useModalBehavior({ open, onClose: requestClose });

  if (!open) return null;

  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) requestClose();
  };

  const closeHandle: ModalCloseHandle = { requestClose, pending, dirty };

  return createPortal(
    <>
      <ModalCloseContext.Provider value={closeHandle}>
        <div
          className="ui-modal-overlay"
          onMouseDown={onBackdrop}
          data-ui-modal-overlay
        >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={pending || undefined}
          data-ui-modal={size}
          className={cn("ui-modal", `ui-modal--${size}`, className)}
        >
          <header className="ui-modal__header">
            <div className="ui-modal__heading">
              <h2 id={titleId} className="ui-modal__title">
                {title}
              </h2>
              {description ? (
                <p className="ui-modal__desc">{description}</p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ui-modal__close"
              onClick={requestClose}
              disabled={pending}
              aria-label={closeLabel}
            >
              <X />
            </Button>
          </header>

          <div className="ui-modal__body">{children}</div>

          {footer || footerStatus ? (
            <footer className="ui-modal__footer">
              {footerStatus ? (
                <div
                  className={cn(
                    "ui-modal__footer-status",
                    statusTone === "error" &&
                      "ui-modal__footer-status--error",
                  )}
                  role={statusTone === "error" ? "alert" : undefined}
                >
                  {footerStatus}
                </div>
              ) : null}
              {footer}
            </footer>
          ) : null}
          </div>
        </div>
      </ModalCloseContext.Provider>

      <ConfirmInline
        open={discardOpen}
        title={discardTitle}
        description={discardDescription}
        confirmLabel={discardConfirmLabel}
        cancelLabel={discardCancelLabel}
        destructive
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>,
    document.body,
  );
}

/** Confirm variant inside the shared frame. Built here (not imported from
 *  ConfirmDialog.tsx) so Modal stays the single owner of the discard flow
 *  without a circular import. */
function ConfirmInline({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const ref = useModalBehavior({ open, onClose: onCancel });
  if (!open) return null;

  return createPortal(
    <div
      className="ui-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-modal ui-modal--sm"
      >
        <header className="ui-modal__header">
          <div className="ui-modal__heading">
            <h2 id={titleId} className="ui-modal__title">
              {title}
            </h2>
            {description ? (
              <p className="ui-modal__desc">{description}</p>
            ) : null}
          </div>
        </header>
        <footer className="ui-modal__footer">
          <Button variant="secondary" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
