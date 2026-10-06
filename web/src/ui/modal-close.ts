import { createContext, useContext } from "react";

/**
 * Close handle published by `Modal` to everything rendered inside it.
 *
 * Footer actions MUST dismiss through this instead of calling the parent's
 * `onClose` directly: only `requestClose` applies the dirty guard and the
 * pending lock, so a footer Cancel cannot bypass them. Use `ModalCancel`,
 * or `useModalClose().requestClose` for custom affordances.
 */
export interface ModalCloseHandle {
  requestClose: () => void;
  pending: boolean;
  dirty: boolean;
}

export const ModalCloseContext = createContext<ModalCloseHandle | null>(null);

export function useModalClose(): ModalCloseHandle {
  const context = useContext(ModalCloseContext);
  if (!context) throw new Error("ModalCancel must be rendered inside Modal");
  return context;
}
