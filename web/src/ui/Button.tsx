import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dashboard-owned button primitive.
 *
 * Owns its class contract (`.ui-btn` in ui.css) instead of the design
 * system's utility-chain hooks, so the theme layer no longer has to match
 * on utility substrings and every theme gets the same readable geometry.
 *
 * The prop surface is a superset of the design system's `Button`
 * (`ghost` / `outlined` / `destructive` / `prefix` / `size="xs|sm|default|
 * icon"`) so page imports can be migrated to `@/ui` without touching every
 * call site. New code should prefer `variant`.
 */
export type UiButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-ghost";

export type UiButtonSize =
  | "xs"
  | "sm"
  | "md"
  | "default"
  | "lg"
  | "icon"
  | "icon-sm";

export interface UiButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "prefix"> {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  loading?: boolean;
  /** Leading adornment (alias of the legacy `prefix`). */
  icon?: ReactNode;
  /** Legacy leading adornment. */
  prefix?: ReactNode;
  suffix?: ReactNode;
  block?: boolean;
  /** Legacy design-system variant flags. Prefer `variant`. */
  ghost?: boolean;
  outlined?: boolean;
  destructive?: boolean;
  invert?: boolean;
  /** Marks this control as the modal's initial focus target. */
  "data-autofocus"?: boolean;
}

const VARIANT_CLASS: Record<UiButtonVariant, string> = {
  primary: "ui-btn--primary",
  secondary: "ui-btn--secondary",
  ghost: "ui-btn--ghost",
  danger: "ui-btn--danger",
  "danger-ghost": "ui-btn--danger-ghost",
};

const SIZE_CLASS: Record<UiButtonSize, string> = {
  xs: "ui-btn--xs",
  sm: "ui-btn--sm",
  md: "",
  default: "",
  lg: "ui-btn--lg",
  icon: "ui-btn--icon",
  "icon-sm": "ui-btn--icon ui-btn--sm",
};

/** Legacy flags map onto the same variant ladder the owned components use. */
function resolveVariant({
  variant,
  ghost,
  outlined,
  destructive,
  invert,
}: Pick<
  UiButtonProps,
  "variant" | "ghost" | "outlined" | "destructive" | "invert"
>): UiButtonVariant {
  if (variant) return variant;
  if (destructive) return ghost ? "danger-ghost" : "danger";
  if (ghost) return "ghost";
  if (outlined) return "secondary";
  if (invert) return "primary";
  return "primary";
}

export const Button = forwardRef<HTMLButtonElement, UiButtonProps>(
  function Button(
    {
      variant,
      size = "md",
      loading = false,
      icon,
      prefix,
      suffix,
      block = false,
      ghost = false,
      outlined = false,
      destructive = false,
      invert = false,
      className,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) {
    const resolvedVariant = resolveVariant({
      variant,
      ghost,
      outlined,
      destructive,
      invert,
    });
    const leading = icon ?? prefix;
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-ui-button={resolvedVariant}
        className={cn(
          "ui-btn",
          VARIANT_CLASS[resolvedVariant],
          SIZE_CLASS[size],
          block && "ui-btn--block",
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          leading
        )}
        {children}
        {suffix}
      </button>
    );
  },
);
