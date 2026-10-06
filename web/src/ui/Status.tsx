import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "muted" | "neutral";

const TONE_CLASS: Record<Exclude<StatusTone, "neutral">, string> = {
  success: "ui-status--success",
  warning: "ui-status--warning",
  danger: "ui-status--danger",
  muted: "ui-status--muted",
};

/**
 * Dot + plain text status, per the design language: a pill is for counts,
 * not for connection state. `neutral` renders no dot (pure label).
 */
export function StatusText({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn("ui-status", tone !== "neutral" && TONE_CLASS[tone], className)}
      title={title}
    >
      {tone !== "neutral" ? <span className="ui-status__dot" aria-hidden /> : null}
      <span>{children}</span>
    </span>
  );
}

export type BadgeTone =
  | "default"
  | "accent"
  | "danger"
  | "warning"
  | "success"
  | "outline"
  // Legacy design-system aliases, kept so page imports can move to `@/ui`
  // without a tone rewrite.
  | "destructive"
  | "secondary";

function badgeToneClass(tone: BadgeTone): string | undefined {
  switch (tone) {
    case "accent":
      return "ui-badge--accent";
    case "danger":
    case "destructive":
      return "ui-badge--danger";
    case "warning":
      return "ui-badge--warning";
    case "success":
      return "ui-badge--success";
    case "outline":
      return "ui-badge--outline";
    case "secondary":
    case "default":
    default:
      return undefined;
  }
}

export interface UiBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({
  tone = "default",
  children,
  className,
  ...props
}: UiBadgeProps) {
  return (
    <span
      className={cn("ui-badge", badgeToneClass(tone), className)}
      {...props}
    >
      {children}
    </span>
  );
}
