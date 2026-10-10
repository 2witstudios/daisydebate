import type { ConnectionDiagnostic } from './connection-diagnostics';
import type { ServerMessage } from '@daisy/protocol';
import type { TerminalReason } from './close-code-policy';

/**
 * The subset of the browser's native `WebSocket` this store uses. Tests
 * inject a fake; production wiring injects the real global `WebSocket`
 * (ADR 0031 §3: native WebSocket only, no client library).
 */
export type WebSocketLike = {
  readonly send: (data: string) => void;
  readonly close: (code?: number, reason?: string) => void;
  readonly addEventListener: (
    type: 'open' | 'message' | 'close',
    listener: (event: { readonly [key: string]: unknown }) => void,
  ) => void;
};

/**
 * The injected timing seam: production wires real `performance.now`/
 * `setTimeout`/`clearTimeout`; tests wire a virtual clock and timer queue so
 * the heartbeat and backoff rules are proven deterministically (AGENTS.md:
 * inject clocks, never sleep-and-hope).
 */
export type Scheduler = {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
};

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

export type ConnectionState = {
  readonly status: ConnectionStatus;
  readonly generation: number;
  readonly terminal: TerminalReason | null;
};

export type ConnectionStoreDeps = {
  readonly url: string;
  readonly createSocket: (url: string) => WebSocketLike;
  readonly scheduler: Scheduler;
  readonly fetchTicket: () => Promise<string>;
  readonly random: () => number;
  /** Registers a visibility listener; the callback receives `true` when the
   * tab becomes visible. Returns an unsubscribe function. */
  readonly onVisibilityChange: (
    callback: (visible: boolean) => void,
  ) => () => void;
};

export type ConnectionStore = {
  readonly onDiagnostic: (
    listener: (event: ConnectionDiagnostic) => void,
  ) => () => void;
  readonly subscribeTopic: (
    topic: string,
    listener: (frame: ServerMessage) => void,
  ) => () => void;
  readonly onMessage: (listener: (frame: ServerMessage) => void) => () => void;
  readonly resubscribeTopic: (topic: string) => void;
  /** Single-flight: a no-op while already connecting or open. */
  readonly connect: () => void;
  /** User-initiated close (logout): closes the socket, never reconnects. */
  readonly close: () => void;
  /**
   * A token refresh never reconnects a healthy socket: this is a documented
   * no-op seam, kept so callers have somewhere to report the refresh without
   * reaching into the store's internals.
   */
  readonly notifyTokenRefreshed: () => void;
  readonly getState: () => ConnectionState;
  readonly subscribe: (
    listener: (state: ConnectionState) => void,
  ) => () => void;
};
