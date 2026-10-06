import { getNestedValue, setNestedValue } from "./nested";

/**
 * Reset a scoped set of config keys to their default values.
 *
 * Pure by design: the page only replaces its in-memory draft, so nothing is
 * written to config.yaml until the user presses Save.
 */
export function applyScopedReset(
  config: Record<string, unknown>,
  defaults: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  let next = config;
  for (const key of keys) {
    next = setNestedValue(next, key, getNestedValue(defaults, key));
  }
  return next;
}
