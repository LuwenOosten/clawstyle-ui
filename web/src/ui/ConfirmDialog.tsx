import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { ModalCancel } from "./ModalCancel";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra detail rendered under the description (e.g. a warning list). */
  footerStatus?: ReactNode;
}

/**
 * Shared confirmation dialog. Opens on the safe choice (Cancel) and blocks
 * every close path while `loading` so an in-flight action cannot be
 * unmounted or fired twice.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  footerStatus,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      pending={loading}
      footerStatus={footerStatus}
      statusTone={destructive ? "error" : "muted"}
      footer={
        <>
          <ModalCancel data-autofocus>{cancelLabel}</ModalCancel>
          <Button
            variant={destructive ? "danger" : "primary"}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
