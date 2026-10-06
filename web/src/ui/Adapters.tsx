import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  LabelHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Stable adapters for the installed design-system's presentational
 * primitives. They keep the imported component names and prop shapes while
 * rendering the dashboard-owned surface/row contracts, so page imports can
 * move to `@/ui` without touching call sites or business logic.
 */

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

/** Theme component-style hooks the DS card used; preserved so themes that
 *  set `--component-card-*` keep their treatment. */
const CARD_STYLE = {
  background: "var(--component-card-background)",
  borderImage: "var(--component-card-border-image)",
  boxShadow: "var(--component-card-box-shadow)",
  clipPath: "var(--component-card-clip-path)",
} as const;

export function Card({
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("ui-surface w-full text-left", className)}
      style={{ ...CARD_STYLE, ...style }}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-b border-border p-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("ui-section-heading text-[13.5px]", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-xs leading-relaxed text-text-muted", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/* Label                                                               */
/* ------------------------------------------------------------------ */

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("ui-field__label", className)} {...props} />;
}

/* ------------------------------------------------------------------ */
/* ListItem                                                            */
/* ------------------------------------------------------------------ */

export interface ListItemProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function ListItem({
  active = false,
  className,
  type = "button",
  ...props
}: ListItemProps) {
  return (
    <button
      type={type}
      data-active={active || undefined}
      aria-current={active ? "true" : undefined}
      className={cn(
        "ui-nav__item",
        active && "ui-nav__item--active",
        className,
      )}
      {...props}
    />
  );
}
