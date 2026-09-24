import {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  heartbeatMs,
} from '@daisy/protocol';
import { nextReconnectDelayMs } from './backoff';
import { decideOnClose, type TerminalReason } from './close-code-policy';

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
 * The injected timing seam: production wires real `Date.now`/
 * `setTimeout`/`clearTimeout`; tests wire a virtual clock and timer queue so
 * the heartbeat and backoff rules are proven deterministically (AGENTS.md:
 * inject clocks, never sleep-and-hope).
 */
export type Scheduler = {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
};

type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

type ConnectionState = {
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

const HEARTBEAT_DEAD_AFTER_MS = heartbeatMs * 2;

export function createConnectionStore(
  deps: ConnectionStoreDeps,
): ConnectionStore {
  let generation = 0;
  let status: ConnectionStatus = 'idle';
  let terminal: TerminalReason | null = null;
  let socket: WebSocketLike | null = null;
  let consecutiveAuthFailures = 0;
  let reconnectAttempt = 0;
  let lastPongAt = 0;
  let pingCounter = 0;
  let heartbeatTimer: unknown = null;
  let reconnectTimer: unknown = null;
  const listeners = new Set<(state: ConnectionState) => void>();

  deps.onVisibilityChange((visible) => {
    if (visible && status === 'open' && socket) sendPing(generation);
  });

  function snapshot(): ConnectionState {
    return { status, generation, terminal };
  }
  function notify() {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }
  function clearHeartbeat() {
    if (heartbeatTimer !== null) deps.scheduler.clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  function clearReconnect() {
    if (reconnectTimer !== null) deps.scheduler.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  function sendPing(myGeneration: number) {
    if (myGeneration !== generation || !socket) return;
    pingCounter += 1;
    socket.send(
      JSON.stringify({
        v: ENVELOPE_VERSION,
        type: 'ping',
        id: `ping-${pingCounter}`,
      }),
    );
  }
  function scheduleHeartbeatTick(myGeneration: number) {
    heartbeatTimer = deps.scheduler.setTimeout(() => {
      if (myGeneration !== generation) return;
      const elapsed = deps.scheduler.now() - lastPongAt;
      if (elapsed >= HEARTBEAT_DEAD_AFTER_MS) {
        // Half-open: reap it locally. Bumping the generation first makes
        // this socket's own listeners stale, so the synchronous close event
        // triggered below cannot also run handleClose and double-schedule
        // a reconnect.
        clearHeartbeat();
        generation += 1;
        const deadSocket = socket;
        socket = null;
        status = 'closed';
        try {
          deadSocket?.close();
        } catch {
          // The socket may already be closing; nothing to react to.
        }
        notify();
        scheduleReconnect('standard');
        return;
      }
      sendPing(myGeneration);
      scheduleHeartbeatTick(myGeneration);
    }, heartbeatMs);
  }
  function startHeartbeat(myGeneration: number) {
    clearHeartbeat();
    lastPongAt = deps.scheduler.now();
    scheduleHeartbeatTick(myGeneration);
  }

  function scheduleReconnect(kind: 'standard' | 'rate-limited' | 'immediate') {
    reconnectAttempt += 1;
    const delayMs = nextReconnectDelayMs({
      kind,
      attempt: reconnectAttempt - 1,
      random: deps.random,
    });
    clearReconnect();
    reconnectTimer = deps.scheduler.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  function handleOpen(myGeneration: number, ticket: string | null) {
    if (myGeneration !== generation) return;
    if (ticket !== null) sendHello(myGeneration, ticket);
  }
  function sendHello(myGeneration: number, ticket: string) {
    if (myGeneration !== generation || !socket) return;
    socket.send(
      JSON.stringify({
        v: ENVELOPE_VERSION,
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ticket,
      }),
    );
  }
  function handleMessage(myGeneration: number, raw: unknown) {
    if (myGeneration !== generation) return;
    if (typeof raw !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const type = Reflect.get(message, 'type');
    if (type === 'ready') {
      status = 'open';
      terminal = null;
      consecutiveAuthFailures = 0;
      reconnectAttempt = 0;
      startHeartbeat(myGeneration);
      notify();
      return;
    }
    if (type === 'pong') {
      lastPongAt = deps.scheduler.now();
    }
  }
  function handleClose(myGeneration: number, code: number) {
    if (myGeneration !== generation) return;
    clearHeartbeat();
    socket = null;
    const decision = decideOnClose({ code, consecutiveAuthFailures });
    if (code === 4001) consecutiveAuthFailures += 1;
    else consecutiveAuthFailures = 0;
    if (!decision.reconnect) {
      status = 'closed';
      terminal = decision.terminal;
      notify();
      return;
    }
    status = 'closed';
    terminal = null;
    notify();
    scheduleReconnect(decision.backoffKind);
  }

  function connect() {
    if (status === 'connecting' || status === 'open') return;
    generation += 1;
    const myGeneration = generation;
    status = 'connecting';
    terminal = null;
    clearReconnect();
    notify();

    const newSocket = deps.createSocket(deps.url);
    socket = newSocket;
    let opened = false;
    let ticket: string | null = null;
    const tryHello = () => {
      if (opened && ticket !== null) handleOpen(myGeneration, ticket);
    };
    newSocket.addEventListener('open', () => {
      if (myGeneration !== generation) return;
      opened = true;
      tryHello();
    });
    newSocket.addEventListener('message', (event) => {
      handleMessage(myGeneration, event.data);
    });
    newSocket.addEventListener('close', (event) => {
      const code = typeof event.code === 'number' ? event.code : 1006;
      handleClose(myGeneration, code);
    });
    deps
      .fetchTicket()
      .then((value) => {
        if (myGeneration !== generation) return;
        ticket = value;
        tryHello();
      })
      .catch(() => {
        if (myGeneration !== generation) return;
        try {
          newSocket.close();
        } catch {
          // A close event (if any) drives the usual reconnect path.
        }
      });
  }

  function close() {
    clearReconnect();
    clearHeartbeat();
    generation += 1;
    status = 'closed';
    terminal = null;
    consecutiveAuthFailures = 0;
    reconnectAttempt = 0;
    const current = socket;
    socket = null;
    notify();
    try {
      current?.close(1000, 'logout');
    } catch {
      // Already closed; nothing further to do.
    }
  }

  return {
    connect,
    close,
    notifyTokenRefreshed: () => {
      // Intentionally a no-op: a token refresh never reconnects a healthy
      // socket (RT-2.6a AC4). The seam exists so a caller has somewhere to
      // report the refresh rather than reaching into this store's internals.
    },
    getState: snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
