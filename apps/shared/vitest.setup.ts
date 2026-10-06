/**
 * Node 22 ships a global `WebSocket` (undici) but no global `CloseEvent`.
 * The gateway connect tests construct CloseEvent directly, and the i18n tests
 * assert that `document` is undefined, so the suite stays in the node
 * environment with only this DOM constructor filled in.
 */
class CloseEventShim extends Event {
  readonly code: number
  readonly reason: string
  readonly wasClean: boolean

  constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
    super(type)
    this.code = init.code ?? 0
    this.reason = init.reason ?? ''
    this.wasClean = init.wasClean ?? false
  }
}

const globalWithCloseEvent = globalThis as typeof globalThis & { CloseEvent?: unknown }
if (typeof globalWithCloseEvent.CloseEvent === 'undefined') {
  globalWithCloseEvent.CloseEvent = CloseEventShim
}
