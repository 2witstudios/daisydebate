import { createConnectionDiagnostics } from './connection-diagnostics';
import {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  heartbeatMs,
} from '@daisy/protocol';
import { createActivityReport } from './presence-activity';
import {
  createTopicSubscriptions,
  parseServerMessage,
} from './topic-subscriptions';
import { nextReconnectDelayMs } from './backoff';
import { createOutstandingPing } from './outstanding-ping';
import {
  closeReasonForCode,
  decideOnClose,
  type TerminalReason,
} from './close-code-policy';

import type {
  ConnectionStore,
  ConnectionStoreDeps,
  ConnectionStatus,
  ConnectionState,
  WebSocketLike,
} from './connection-types';
export type {
  ConnectionStore,
  ConnectionStoreDeps,
  Scheduler,
  WebSocketLike,
} from './connection-types';

const HEARTBEAT_DEAD_AFTER_MS = heartbeatMs * 2;

export function createConnectionStore(
  deps: ConnectionStoreDeps,
): ConnectionStore {
  const diagnostics = createConnectionDiagnostics();
  let generation = 0;
  let status: ConnectionStatus = 'idle';
  let terminal: TerminalReason | null = null;
  let socket: WebSocketLike | null = null;
  let consecutiveAuthFailures = 0;
  let reconnectAttempt = 0;
  // Death is judged by the oldest unanswered ping's age, never by how late a
  // (possibly throttled) tick ran.
  const outstanding = createOutstandingPing(HEARTBEAT_DEAD_AFTER_MS);
  let pingCounter = 0;
  let heartbeatTimer: unknown = null;
  let reconnectTimer: unknown = null;
  const activity = createActivityReport(
    (frame) => socket?.send(frame),
    deps.reportsPresence === true,
  );
  const listeners = new Set<(state: ConnectionState) => void>();
  const topics = createTopicSubscriptions({
    send: (frame) => {
      if (status === 'open' && socket) socket.send(JSON.stringify(frame));
    },
  });

  let disposed = false;
  const lifetime = new AbortController();
  const stopVisibility = deps.onVisibilityChange((visible) => {
    if (visible && status === 'open' && socket) sendVisibilityPing(generation);
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
  /** Sends a ping frame and returns its id, or undefined if nothing was sent. */
  function sendPingFrame(myGeneration: number): string | undefined {
    if (myGeneration !== generation || !socket) return undefined;
    pingCounter += 1;
    const id = `ping-${pingCounter}`;
    socket.send(JSON.stringify({ v: ENVELOPE_VERSION, type: 'ping', id }));
    return id;
  }
  /**
   * Sends a fresh ping known to be the only one in flight (on `ready`, or a
   * tick that found nothing outstanding) and starts tracking its deadline.
   * Tracking is set before the socket send so that a synchronously-delivered
   * pong (real sockets never are, but a test double may be) still clears it
   * rather than being overwritten afterward — this requires knowing the id
   * in advance, so `pingCounter` is read here rather than inside `sendPingFrame`.
   */
  function sendFreshPing(myGeneration: number) {
    pingCounter += 1;
    const id = `ping-${pingCounter}`;
    outstanding.track(id, deps.scheduler.now(), true);
    if (myGeneration !== generation || !socket) return;
    socket.send(JSON.stringify({ v: ENVELOPE_VERSION, type: 'ping', id }));
  }
  /**
   * The visibilitychange nudge (ADR 0031 §7: "pings at once on
   * visibilitychange"): always sent on the wire, but it only starts tracking
   * a deadline when nothing is currently outstanding. If an earlier ping is
   * still awaiting its answer, this must never push that ping's own deadline
   * later — repeated visibility changes could otherwise defer detecting a
   * truly dead socket forever.
   */
  function sendVisibilityPing(myGeneration: number) {
    const id = sendPingFrame(myGeneration);
    if (id !== undefined) outstanding.track(id, deps.scheduler.now());
  }
  function reapDeadSocket(myGeneration: number) {
    if (myGeneration !== generation) return;
    // Half-open: reap it locally. Bumping the generation first makes this
    // socket's own listeners stale, so the synchronous close event
    // triggered below cannot also run handleClose and double-schedule a
    // reconnect.
    clearHeartbeat();
    outstanding.clear();
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
  }
  function scheduleHeartbeatTick(myGeneration: number) {
    heartbeatTimer = deps.scheduler.setTimeout(() => {
      if (myGeneration !== generation) return;
      if (outstanding.overdue(deps.scheduler.now())) {
        // The ping that is overdue was actually sent (and given its own
        // deadline) at send time, so this fires only when the server truly
        // failed to answer it within HEARTBEAT_DEAD_AFTER_MS of *that* send
        // — never merely because this tick itself ran late.
        reapDeadSocket(myGeneration);
        return;
      }
      if (!outstanding.pending()) {
        // The previous ping (if any) was already answered: send a fresh one
        // and start tracking its own deadline. A tick that finds a ping
        // still outstanding but not yet overdue sends nothing and waits.
        sendFreshPing(myGeneration);
      }
      scheduleHeartbeatTick(myGeneration);
    }, heartbeatMs);
  }
  function startHeartbeat(myGeneration: number) {
    clearHeartbeat();
    sendFreshPing(myGeneration);
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
    diagnostics.emit(myGeneration, 'hello-sent');
  }
  function handleMessage(myGeneration: number, raw: unknown) {
    if (myGeneration !== generation) return;
    if (typeof raw !== 'string') return;
    const frame = parseServerMessage(raw);
    if (!frame) return;
    const type = frame.type;
    if (type === 'ready') {
      if (status !== 'connecting') return;
      status = 'open';
      terminal = null;
      consecutiveAuthFailures = 0;
      reconnectAttempt = 0;
      startHeartbeat(myGeneration);
      activity.ready();
      topics.reconnect();
      notify();
      topics.emit(frame);
      return;
    }
    if (status !== 'open') return;
    if (type === 'pong') {
      // Only a pong matching the earliest outstanding ping's own id clears
      // it (ADR 0031 §7): a late pong for an older, already-superseded ping
      // must never cancel a newer ping's still-live deadline.
      outstanding.answer(frame.id);
    }
    topics.emit(frame);
  }
  function handleClose(myGeneration: number, code: number) {
    if (myGeneration !== generation) return;
    clearHeartbeat();
    outstanding.clear();
    socket = null;
    const decision = decideOnClose({ code, consecutiveAuthFailures });
    if (closeReasonForCode(code) === 'auth_failed')
      consecutiveAuthFailures += 1;
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
    if (disposed || status === 'connecting' || status === 'open') return;
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
    const fail = (phase: 'ticket-failed' | 'hello-failed', error: unknown) => {
      if (myGeneration !== generation) return;
      diagnostics.emit(myGeneration, phase, error);
      try {
        newSocket.close();
      } catch {
        /* Close events drive reconnect. */
      }
    };
    const tryHello = () => {
      if (!opened || ticket === null) return;
      try {
        handleOpen(myGeneration, ticket);
      } catch (error) {
        fail('hello-failed', error);
      }
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
      .fetchTicket(lifetime.signal)
      .then((value) => {
        if (myGeneration !== generation) return;
        ticket = value;
        diagnostics.emit(myGeneration, 'ticket-resolved');
        tryHello();
      })
      .catch((error: unknown) => fail('ticket-failed', error));
  }

  function close() {
    clearReconnect();
    clearHeartbeat();
    generation += 1;
    status = 'closed';
    terminal = null;
    consecutiveAuthFailures = 0;
    reconnectAttempt = 0;
    outstanding.clear();
    const current = socket;
    socket = null;
    topics.clear();
    notify();
    try {
      current?.close(1000, 'logout');
    } catch {
      // Already closed; nothing further to do.
    }
  }

  // RT-2.6a-arch1: `close`'s generation fences late tickets and sockets.
  function dispose() {
    if (disposed) return;
    close();
    disposed = true;
    for (const release of [stopVisibility, topics.release, diagnostics.release])
      release();
    listeners.clear();
    lifetime.abort();
  }
  /** After disposal a registration retains nothing. */
  const live =
    <A extends unknown[]>(register: (...args: A) => () => unknown) =>
    (...args: A) =>
      disposed ? () => {} : register(...args);

  return {
    onDiagnostic: live(diagnostics.subscribe),
    subscribeTopic: live(topics.subscribe),
    onMessage: live(topics.onMessage),
    resubscribeTopic: topics.resubscribe,
    connect,
    close,
    dispose,
    reportActivity: (next) => activity.report(next, status === 'open'),
    notifyTokenRefreshed: () => {
      // Intentionally a no-op: a token refresh never reconnects a healthy
      // socket (RT-2.6a AC4). The seam exists so a caller has somewhere to
      // report the refresh rather than reaching into this store's internals.
    },
    getState: snapshot,
    subscribe: live((listener: (state: ConnectionState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
}
