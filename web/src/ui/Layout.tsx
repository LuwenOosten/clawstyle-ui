import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Field — label + hint/error above one control                        */
/* ------------------------------------------------------------------ */

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  stacked = true,
  className,
}: FieldProps) {
  if (!stacked) {
    return (
      <div className={cn("ui-settings-row", className)}>
        <div className="ui-settings-row__text">
          {label ? (
            <label className="ui-settings-row__title" htmlFor={htmlFor}>
              {label}
            </label>
          ) : null}
          {hint ? <span className="ui-settings-row__desc">{hint}</span> : null}
          {error ? <span className="ui-field__error">{error}</span> : null}
        </div>
        <div className="ui-settings-row__control">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("ui-field", className)}>
      {label ? (
        <label className="ui-field__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {hint ? <span className="ui-field__hint">{hint}</span> : null}
      <div className="ui-field__control">{children}</div>
      {error ? <span className="ui-field__error">{error}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section + group + row                                               */
/* ------------------------------------------------------------------ */

export interface SettingsSectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn("ui-settings-section", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="ui-settings-section__heading">{title}</h2>
        {actions ? (
          <div className="ui-settings-section__actions">{actions}</div>
        ) : null}
      </div>
      {description ? (
        <p className="ui-settings-section__desc">{description}</p>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsGroup({
  children,
  className,
  plain = false,
}: {
  children: ReactNode;
  className?: string;
  plain?: boolean;
}) {
  return (
    <div
      className={cn(
        "ui-settings-group",
        plain && "ui-settings-group--plain",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SettingsRowProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Wires the title to a single control (label / switch / input). */
  htmlFor?: string;
  children?: ReactNode;
  /** Renders the row as a whole clickable control. */
  onClick?: () => void;
  stacked?: boolean;
  className?: string;
}

export function SettingsRow({
  title,
  description,
  htmlFor,
  children,
  onClick,
  stacked = false,
  className,
}: SettingsRowProps) {
  const rowClassName = cn(
    "ui-settings-row",
    stacked && "ui-settings-row--stacked",
    onClick && "ui-row-button w-full text-left",
    className,
  );
  const content = (
    <>
      <div className="ui-settings-row__text">
        {title ? (
          htmlFor ? (
            <label className="ui-settings-row__title" htmlFor={htmlFor}>
              {title}
            </label>
          ) : (
            <span className="ui-settings-row__title">{title}</span>
          )
        ) : null}
        {description ? (
          <span className="ui-settings-row__desc">{description}</span>
        ) : null}
      </div>
      {children !== undefined ? (
        <div className="ui-settings-row__control">{children}</div>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={rowClassName}>
        {content}
      </button>
    );
  }

  return <div className={rowClassName}>{content}</div>;
}

/* ------------------------------------------------------------------ */
/* Page-level helpers                                                  */
/* ------------------------------------------------------------------ */

export function SectionHeading({
  children,
  count,
  actions,
  className,
}: {
  children: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <h2 className="ui-section-heading">
        {children}
        {count !== undefined ? (
          <span className="ui-section-heading__count">{count}</span>
        ) : null}
      </h2>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Disclosure — labeled advanced-options tier                          */
/* ------------------------------------------------------------------ */

export interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  id?: string;
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  id,
}: DisclosureProps) {
  return (
    <details className={cn("ui-disclosure", className)} open={defaultOpen} id={id}>
      <summary>
        <ChevronRight className="ui-disclosure__chevron" aria-hidden />
        <span>{summary}</span>
      </summary>
      <div className="ui-disclosure__body">{children}</div>
    </details>
  );
}
