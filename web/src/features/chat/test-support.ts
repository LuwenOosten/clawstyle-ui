/**
 * Test doubles for the native chat controller. Not imported by production
 * code; lives outside `*.test.ts` so the fake can be shared by the controller
 * and page suites.
 */
import type {
  ConnectionState,
  GatewayEvent,
  GatewayEventName,
  ServerRequest,
} from "@hermes/shared";

import type { ChatTransport } from "./controller";

type EventHandler = (event: GatewayEvent) => void;
type StateHandler = (state: ConnectionState) => void;
type RequestHandler = (request: ServerRequest) => boolean | void;

export class FakeGateway implements ChatTransport {
  connectionState: ConnectionState = "open";
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly responses = new Map<
    string,
    (params: Record<string, unknown>) => unknown | Promise<unknown>
  >();
  readonly failures = new Map<string, Error>();
  connectCalls = 0;
  closeCalls = 0;
  /** Ordered log of RPC methods and barrier waits (race assertions). */
  readonly order: string[] = [];

  private readonly eventHandlers = new Map<string, Set<EventHandler>>();
  private readonly stateHandlers = new Set<StateHandler>();
  private readonly requestHandlers: RequestHandler[] = [];

  connect(): Promise<void> {
    this.connectCalls += 1;
    this.emitState("open");
    return Promise.resolve();
  }

  close(): void {
    this.closeCalls += 1;
    this.emitState("closed");
  }

  sessionReplayBarrier(sessionId: string): Promise<boolean> {
    this.order.push(`barrier:${sessionId}`);
    return Promise.resolve(true);
  }

  request<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.calls.push({ method, params });
    this.order.push(method);
    const failure = this.failures.get(method);
    if (failure) return Promise.reject(failure);
    const responder = this.responses.get(method);
    if (!responder) return Promise.resolve({} as T);
    return Promise.resolve(responder(params) as T);
  }

  on<K extends GatewayEventName>(
    type: K,
    handler: (event: GatewayEvent<K>) => void,
  ): () => void {
    const set = this.eventHandlers.get(type) ?? new Set<EventHandler>();
    this.eventHandlers.set(type, set);
    set.add(handler as EventHandler);
    return () => set.delete(handler as EventHandler);
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.connectionState);
    return () => this.stateHandlers.delete(handler);
  }

  onRequest(handler: RequestHandler): () => void {
    this.requestHandlers.push(handler);
    return () => {
      const index = this.requestHandlers.indexOf(handler);
      if (index >= 0) this.requestHandlers.splice(index, 1);
    };
  }

  emit<K extends GatewayEventName>(
    type: K,
    payload: Record<string, unknown> | undefined,
    overrides: Partial<GatewayEvent<K>> = {},
  ): void {
    const event = {
      type,
      ...(payload === undefined ? {} : { payload }),
      ...overrides,
    } as GatewayEvent<K>;
    for (const handler of this.eventHandlers.get(type) ?? []) {
      handler(event);
    }
  }

  emitState(state: ConnectionState): void {
    this.connectionState = state;
    for (const handler of [...this.stateHandlers]) handler(state);
  }

  serverRequest(request: ServerRequest): void {
    for (const handler of [...this.requestHandlers]) {
      if (handler(request) !== false) return;
    }
  }

  methods(): string[] {
    return this.calls.map((call) => call.method);
  }

  callsFor(method: string): Array<Record<string, unknown>> {
    return this.calls.filter((call) => call.method === method).map((call) => call.params);
  }
}

/** Build a server request double with spy-able answer hooks. */
export function fakeServerRequest(
  method: string,
  params: Record<string, unknown>,
  id = "req-1",
): ServerRequest & {
  responded: Array<Record<string, unknown>>;
  failed: Array<{ code: number; message: string }>;
} {
  const responded: Array<Record<string, unknown>> = [];
  const failed: Array<{ code: number; message: string }> = [];
  return {
    id,
    method,
    params,
    responded,
    failed,
    respond(result: Record<string, unknown>) {
      responded.push(result);
    },
    fail(code: number, message: string) {
      failed.push({ code, message });
    },
  };
}
