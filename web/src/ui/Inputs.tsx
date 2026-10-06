import {
  Children,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Text inputs                                                         */
/* ------------------------------------------------------------------ */

export interface UiInputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  /** Marks this control as the modal's initial focus target. */
  "data-autofocus"?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, UiInputProps>(
  function TextInput({ className, mono = false, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn("ui-input", mono && "ui-input--mono", className)}
        {...props}
      />
    );
  },
);

export interface UiTextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  "data-autofocus"?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, UiTextareaProps>(
  function TextArea({ className, mono = false, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn("ui-textarea", mono && "ui-textarea--mono", className)}
        {...props}
      />
    );
  },
);

/* ------------------------------------------------------------------ */
/* Select (native, themed with a chevron affordance)                   */
/*                                                                     */
/* Accepts both APIs:                                                   */
/*   <Select options={[{value,label}]} value onChange={e=>...} />       */
/*   <Select value onValueChange={v=>...}><SelectOption .../></Select>  */
/* The second is the installed design system's shape, so page imports   */
/* can move to `@/ui` without rewriting call sites. A `value` that is   */
/* not present in the option list is appended (labelled with itself) so  */
/* a custom/legacy saved model or provider is never silently blanked.   */
/* ------------------------------------------------------------------ */

export interface UiSelectOptionItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface UiSelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options?: UiSelectOptionItem[];
  onValueChange?: (value: string) => void;
  onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"];
  placeholder?: string;
}

/** Marker component; `Select` reads its props to build native options. */
export function SelectOption(props: {
  value: string;
  disabled?: boolean;
  children?: ReactNode;
}): null {
  void props;
  return null;
}

function optionLabel(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionLabel).join("");
  return "";
}

function collectSelectOptions(children: ReactNode): UiSelectOptionItem[] {
  const out: UiSelectOptionItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<{
      value?: string;
      disabled?: boolean;
      children?: ReactNode;
    }>;
    if (element.type === SelectOption || element.type === "option") {
      out.push({
        value: String(element.props.value ?? ""),
        label: optionLabel(element.props.children),
        disabled: element.props.disabled === true,
      });
      return;
    }
    if (element.type === "optgroup") {
      out.push(...collectSelectOptions(element.props.children));
    }
  });
  return out;
}

export const Select = forwardRef<HTMLSelectElement, UiSelectProps>(
  function Select(
    {
      className,
      children,
      options,
      onValueChange,
      onChange,
      placeholder,
      value,
      disabled,
      style,
      ...props
    },
    ref,
  ) {
    const collected = options ?? collectSelectOptions(children);
    const current = value === undefined || value === null ? "" : String(value);
    const list = [...collected];
    if (current && !list.some((option) => option.value === current)) {
      list.push({ value: current, label: current });
    }
    const hasEmptyOption = list.some((option) => option.value === "");
    const showPlaceholder =
      placeholder !== undefined && current === "" && !hasEmptyOption;
    return (
      <span className={cn("ui-select-wrap", className)} style={style}>
        <select
          ref={ref}
          className="ui-select"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange?.(event);
            onValueChange?.(event.target.value);
          }}
          {...props}
        >
          {showPlaceholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {list.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="ui-select-wrap__chevron" aria-hidden />
      </span>
    );
  },
);

/* ------------------------------------------------------------------ */
/* Checkbox                                                            */
/* ------------------------------------------------------------------ */

export interface UiCheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  /** Legacy design-system callback; native `onChange` also works. */
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, UiCheckboxProps>(
  function Checkbox(
    { className, label, id, onCheckedChange, onChange, readOnly, ...props },
    ref,
  ) {
    // Call sites that drive selection from a parent `onClick` (session rows,
    // bulk filters) have no change handler. `readOnly` suppresses React's
    // controlled-input warning; the click still reaches their handler.
    const isControlledByClicks =
      onChange === undefined && onCheckedChange === undefined;
    const input = (
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn("ui-checkbox", className)}
        readOnly={readOnly ?? (isControlledByClicks || undefined)}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.target.checked);
        }}
        {...props}
      />
    );
    if (label === undefined) return input;
    return (
      <label className="ui-check-row" htmlFor={id}>
        {input}
        <span>{label}</span>
      </label>
    );
  },
);

/* ------------------------------------------------------------------ */
/* Switch                                                              */
/* ------------------------------------------------------------------ */

export interface UiSwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  type = "button",
  onClick,
  ...rest
}: UiSwitchProps) {
  return (
    <button
      type={type}
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      data-ui-switch={checked ? "on" : "off"}
      className={cn("ui-switch", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Search input                                                        */
/* ------------------------------------------------------------------ */

export interface UiSearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  onClear?: () => void;
  clearLabel?: string;
  icon?: ReactNode;
  inputClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, UiSearchInputProps>(
  function SearchInput(
    {
      className,
      inputClassName,
      value,
      onClear,
      clearLabel = "Clear",
      icon,
      ...props
    },
    ref,
  ) {
    const hasValue = value !== undefined && String(value).length > 0;
    return (
      <span className={cn("ui-input-group", className)}>
        {icon ?? <Search className="ui-input-group__icon" aria-hidden />}
        <input
          ref={ref}
          type="search"
          value={value}
          className={cn("ui-input", inputClassName)}
          {...props}
        />
        {hasValue && onClear ? (
          <button
            type="button"
            className="ui-input-group__action"
            onClick={onClear}
            aria-label={clearLabel}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </span>
    );
  },
);
