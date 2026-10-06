import { ConfirmDialog as UiConfirmDialog } from "@/ui";

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  description?: string;
  destructive?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}

/**
 * Dashboard confirm dialog. Delegates to the shared `@/ui` frame so every
 * confirmation gets the same focus/escape/lock contract and the same
 * header/body/footer geometry.
 */
export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  description,
  destructive = false,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  return (
    <UiConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      destructive={destructive}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
