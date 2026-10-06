import { Button, type UiButtonProps } from "./Button";
import { useModalClose } from "./modal-close";

/**
 * Semantic Cancel action for a `Modal` footer. Routes through the modal's
 * dirty/pending guard, so a typed draft is never dropped silently and a
 * pending submit cannot be dismissed. Renders a secondary button by
 * default; any other `Button` prop may override the presentation (pass
 * `variant="primary"` for a Done action, for example).
 */
export function ModalCancel({
  children = "Cancel",
  disabled,
  ...props
}: Omit<UiButtonProps, "onClick" | "type">) {
  const { requestClose, pending } = useModalClose();
  return (
    <Button
      variant="secondary"
      type="button"
      {...props}
      onClick={requestClose}
      disabled={pending || disabled}
    >
      {children}
    </Button>
  );
}
