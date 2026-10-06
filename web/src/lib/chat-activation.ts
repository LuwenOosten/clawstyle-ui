/**
 * Chat host activation latch.
 *
 * The dashboard mounts the native chat host lazily and keeps it alive (hidden)
 * across admin routes so a running turn is not orphaned by navigation. This
 * latch makes the first `/chat` visit sticky: once `true`, later navigation
 * never tears the host down.
 */
export function latchChatActivation(previous: boolean, isActive: boolean): boolean {
  return previous || isActive;
}
