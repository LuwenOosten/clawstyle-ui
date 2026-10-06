import {
  Field,
  Select,
  SettingsRow,
  Switch,
  TextArea,
  TextInput,
} from "@/ui";

/**
 * Schema-driven config field. Renders as a settings row (title/help left,
 * one control right) and falls back to a stacked layout for wide editors —
 * the OpenClaw settings anatomy adopted for the whole Config page.
 */
function FieldHint({
  schema,
  schemaKey,
}: {
  schema: Record<string, unknown>;
  schemaKey: string;
}) {
  const keyPath = schemaKey.includes(".") ? schemaKey : "";
  const description = schema.description ? String(schema.description) : "";

  if (!keyPath && !description) return undefined;

  return (
    <span className="flex flex-col gap-0.5">
      {description ? <span>{description}</span> : null}
      {keyPath ? (
        <span className="font-mono text-[11px] text-text-tertiary">
          {keyPath}
        </span>
      ) : null}
    </span>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatScalar(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function NestedValueEditor({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (isRecord(value)) {
    return (
      <div className="grid gap-2 rounded-md border border-border p-2">
        {Object.entries(value).map(([subKey, subVal]) => (
          <Field
            key={subKey}
            label={humanize(subKey)}
            htmlFor={`nested-${fieldKey}.${subKey}`}
          >
            <NestedValueEditor
              fieldKey={`${fieldKey}.${subKey}`}
              value={subVal}
              onChange={(next) => onChange({ ...value, [subKey]: next })}
            />
          </Field>
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div className="grid gap-2">
        {value.map((item, index) => (
          <Field
            key={`${fieldKey}.${index}`}
            label={`Item ${index + 1}`}
            htmlFor={`nested-${fieldKey}.${index}`}
          >
            <NestedValueEditor
              fieldKey={`${fieldKey}.${index}`}
              value={item}
              onChange={(next) =>
                onChange(value.map((existing, i) => (i === index ? next : existing)))
              }
            />
          </Field>
        ))}
      </div>
    );
  }

  return (
    <TextInput
      id={`nested-${fieldKey}`}
      value={formatScalar(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function AutoField({
  schemaKey,
  schema,
  value,
  onChange,
}: AutoFieldProps) {
  const rawLabel = schemaKey.split(".").pop() ?? schemaKey;
  const label = humanize(rawLabel);
  const hint = FieldHint({ schema, schemaKey });

  if (isRecord(value) || (Array.isArray(value) && value.some((item) => isRecord(item)))) {
    return (
      <SettingsRow
        stacked
        title={label}
        description={hint}
        className="ui-settings-row--stacked"
      >
        <div className="ui-field w-full">
          <NestedValueEditor fieldKey={schemaKey} value={value} onChange={onChange} />
        </div>
      </SettingsRow>
    );
  }

  if (schema.type === "boolean") {
    return (
      <SettingsRow title={label} description={hint}>
        <Switch
          checked={!!value}
          onCheckedChange={onChange}
          aria-label={label}
        />
      </SettingsRow>
    );
  }

  if (schema.type === "select") {
    const options = (schema.options as string[]) ?? [];
    return (
      <SettingsRow title={label} description={hint}>
        <Select
          aria-label={label}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-[180px]"
          options={options.map((opt) => ({
            value: opt,
            label: opt || "(none)",
          }))}
        />
      </SettingsRow>
    );
  }

  if (schema.type === "number") {
    return (
      <SettingsRow title={label} description={hint}>
        <TextInput
          type="number"
          aria-label={label}
          className="max-w-[160px]"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(0);
              return;
            }
            const n = Number(raw);
            if (!Number.isNaN(n)) {
              onChange(n);
            }
          }}
        />
      </SettingsRow>
    );
  }

  if (schema.type === "text") {
    return (
      <SettingsRow stacked title={label} description={hint}>
        <TextArea
          aria-label={label}
          className="w-full"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      </SettingsRow>
    );
  }

  if (schema.type === "list") {
    return (
      <SettingsRow title={label} description={hint}>
        <TextInput
          aria-label={label}
          className="min-w-[220px]"
          value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
          placeholder="comma-separated values"
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </SettingsRow>
    );
  }

  return (
    <SettingsRow title={label} description={hint}>
      <TextInput
        aria-label={label}
        className="min-w-[220px]"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </SettingsRow>
  );
}

interface AutoFieldProps {
  schemaKey: string;
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
}
