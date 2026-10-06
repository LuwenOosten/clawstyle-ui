/** Frontend-owned design layer. Import primitives from `@/ui`. */
export { Button } from "./Button";
export type { UiButtonProps, UiButtonVariant, UiButtonSize } from "./Button";

export {
  Checkbox,
  SearchInput,
  Select,
  SelectOption,
  Switch,
  TextArea,
  TextInput,
} from "./Inputs";
export type {
  UiCheckboxProps,
  UiInputProps,
  UiSearchInputProps,
  UiSelectOptionItem,
  UiSelectProps,
  UiSwitchProps,
  UiTextareaProps,
} from "./Inputs";

export {
  Disclosure,
  Field,
  SectionHeading,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "./Layout";
export type {
  DisclosureProps,
  FieldProps,
  SettingsRowProps,
  SettingsSectionProps,
} from "./Layout";

export {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  ListItem,
} from "./Adapters";
export type { ListItemProps } from "./Adapters";

export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";
export { ModalCancel } from "./ModalCancel";

export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";

export { EmptyState, ErrorState, LoadingState, NoMatchState } from "./States";
export type { ErrorStateProps } from "./States";

export { Badge, StatusText } from "./Status";
export type { BadgeTone, StatusTone } from "./Status";

/** `Input` is the design system's name for the same single-line field. */
export { TextInput as Input } from "./Inputs";
