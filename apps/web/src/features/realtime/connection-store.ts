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
import { closeReasonForCode, decideOnClose } from './close-code-policy';
import {
  nextConnectionPhase,
  type ConnectionEvent,
  type ConnectionPhase,
} from './connection-status';

import type {
  ConnectionStore,
  ConnectionStoreDeps,
  ConnectionState,
  WebSocketLike,
} from './connection-types';
export type {
  ConnectionStore,
  ConnectionStoreDeps,
  Scheduler,
  WebSocketLike,
} from './connection-types';

type TicketReadiness =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'socket-open' }
  | { readonly kind: 'ticket-resolved'; readonly ticket: string };

type ConnectionProgress =
  | { readonly phase: Exclude<ConnectionPhase, { status: 'ticketing' }> }
  | {
      readonly phase: Extract<ConnectionPhase, { status: 'ticketing' }>;
      readonly readiness: TicketReadiness;
    };

type ConnectionRuntime = {
  readonly progress: ConnectionProgress;
  readonly generation: number;
  readonly consecutiveAuthFailures: number;
  readonly reconnectAttempt: number;
  readonly authorityFailures: number;
};

const HEARTBEAT_DEAD_AFTER_MS = heartbeatMs * 2;

export function createConnectionStore(
  deps: ConnectionStoreDeps,
): ConnectionStore {
  const diagnostics = createConnectionDiagnostics();
  // Only an answered frame recovers authority, even if ready reset backoff.
  let state: ConnectionRuntime = {
    progress: { phase: { status: 'idle' } },
    generation: 0,
    consecutiveAuthFailures: 0,
    reconnectAttempt: 0,
    authorityFailures: 0,
  };
  let socket: WebSocketLike | null = null;
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
      if (state.progress.phase.status === 'open' && socket)
        socket.send(JSON.stringify(frame));
    },
  });

  const lifetime = new AbortController();
  const stopVisibility = deps.onVisibilityChange((visible) => {
    if (visible && state.progress.phase.status === 'open' && socket)
      sendVisibilityPing(state.generation);
  });

  const disposed = () =>
    state.progress.phase.status === 'closed' &&
    state.progress.phase.why === 'disposed';
  /** Moves the phase; false when the event does not apply where it is. */
  function advance(event: ConnectionEvent): boolean {
    const { phase } = state.progress;
    const next = nextConnectionPhase(phase, event);
    if (next === phase) return false;
    state = {
      ...state,
      progress:
        next.status === 'ticketing'
          ? { phase: next, readiness: { kind: 'waiting' } }
          : { phase: next },
    };
    return true;
  }
  function snapshot(): ConnectionState {
    return { ...state.progress.phase, generation: state.generation };
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
    if (myGeneration !== state.generation || !socket) return undefined;
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
    if (myGeneration !== state.generation || !socket) return;
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
    if (myGeneration !== state.generation) return;
    // Half-open: reap it locally. Bumping the generation first makes this
    // socket's own listeners stale, so the synchronous close event
    // triggered below cannot also run handleClose and double-schedule a
    // reconnect.
    clearHeartbeat();
    outstanding.clear();
    state = { ...state, generation: state.generation + 1 };
    const deadSocket = socket;
    socket = null;
    advance({ type: 'socket-reaped' });
    try {
      deadSocket?.close();
    } catch {
      // The socket may already be closing; nothing to react to.
    }
    scheduleReconnect('standard');
    notify();
  }
  function scheduleHeartbeatTick(myGeneration: number) {
    heartbeatTimer = deps.scheduler.setTimeout(() => {
      if (myGeneration !== state.generation) return;
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

  // Called before the `reconnecting` notice: a listener that leaves, disposes or connects on it clears only a timer already armed.
  function scheduleReconnect(kind: 'standard' | 'rate-limited' | 'immediate') {
    const attempt = state.reconnectAttempt;
    state = { ...state, reconnectAttempt: attempt + 1 };
    const delayMs = nextReconnectDelayMs({
      kind,
      attempt,
      random: deps.random,
    });
    clearReconnect();
    reconnectTimer = deps.scheduler.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  }

  /** Sends hello; true when that began the handshake, which the caller announces. */
  function sendHello(myGeneration: number, ticket: string): boolean {
    if (myGeneration !== state.generation || !socket) return false;
    socket.send(
      JSON.stringify({
        v: ENVELOPE_VERSION,
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ticket,
      }),
    );
    diagnostics.emit(myGeneration, 'hello-sent');
    return advance({ type: 'hello-sent' });
  }
  function handleMessage(myGeneration: number, raw: unknown) {
    if (myGeneration !== state.generation) return;
    if (typeof raw !== 'string') return;
    const frame = parseServerMessage(raw);
    if (!frame) return;
    const type = frame.type;
    if (type === 'ready') {
      if (!advance({ type: 'ready' })) return;
      state = { ...state, consecutiveAuthFailures: 0, reconnectAttempt: 0 };
      startHeartbeat(myGeneration);
      activity.ready();
      topics.reconnect();
      notify();
      topics.emit(frame);
      return;
    }
    if (state.progress.phase.status !== 'open') return;
    if (type === 'pong' || type === 'subscribed')
      state = { ...state, authorityFailures: 0 };
    if (type === 'pong') {
      // Only a pong matching the earliest outstanding ping's own id clears
      // it (ADR 0031 §7): a late pong for an older, already-superseded ping
      // must never cancel a newer ping's still-live deadline.
      outstanding.answer(frame.id);
    }
    topics.emit(frame);
  }
  function handleClose(myGeneration: number, code: number) {
    if (myGeneration !== state.generation) return;
    clearHeartbeat();
    outstanding.clear();
    socket = null;
    const { consecutiveAuthFailures, authorityFailures } = state;
    const decision = decideOnClose({ code, consecutiveAuthFailures });
    const reason = closeReasonForCode(code);
    state = {
      ...state,
      consecutiveAuthFailures:
        reason === 'auth_failed' ? consecutiveAuthFailures + 1 : 0,
    };
    if (reason === 'authority_unavailable')
      state = {
        ...state,
        reconnectAttempt: authorityFailures,
        authorityFailures: authorityFailures + 1,
      };
    advance({ type: 'socket-closed', terminal: decision.terminal });
    if (decision.reconnect) scheduleReconnect(decision.backoffKind);
    notify();
  }

  function connect() {
    if (!advance({ type: 'connect-asked' })) return;
    state = { ...state, generation: state.generation + 1 };
    const myGeneration = state.generation;
    clearReconnect();
    notify();

    if (myGeneration !== state.generation) return;
    const newSocket = deps.createSocket(deps.url);
    socket = newSocket;
    const fail = (phase: 'ticket-failed' | 'hello-failed', error: unknown) => {
      if (myGeneration !== state.generation) return;
      diagnostics.emit(myGeneration, phase, error);
      try {
        newSocket.close();
      } catch {
        /* Close events drive reconnect. */
      }
    };
    const tryHello = (ticket: string) => {
      let handshaking = false;
      try {
        handshaking = sendHello(myGeneration, ticket);
      } catch (error) {
        fail('hello-failed', error);
      }
      // Outside the try: a subscriber throwing here cannot fail hello.
      if (handshaking) notify();
    };
    const currentTicketing = () =>
      myGeneration === state.generation && 'readiness' in state.progress
        ? state.progress
        : null;
    newSocket.addEventListener('open', () => {
      const current = currentTicketing();
      if (!current) return;
      if (current.readiness.kind === 'ticket-resolved')
        tryHello(current.readiness.ticket);
      else
        state = {
          ...state,
          progress: { ...current, readiness: { kind: 'socket-open' } },
        };
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
      .then((ticket) => {
        if (!currentTicketing()) return;
        diagnostics.emit(myGeneration, 'ticket-resolved');
        return ticket;
      })
      .then(
        (ticket) => {
          const current = currentTicketing();
          if (ticket === undefined || !current) return;
          if (current.readiness.kind === 'socket-open') tryHello(ticket);
          else
            state = {
              ...state,
              progress: {
                ...current,
                readiness: { kind: 'ticket-resolved', ticket },
              },
            };
        },
        (error: unknown) => fail('ticket-failed', error),
      );
  }

  function end(how: 'left' | 'disposed') {
    if (disposed()) return;
    advance({ type: how });
    clearReconnect();
    clearHeartbeat();
    state = {
      ...state,
      generation: state.generation + 1,
      consecutiveAuthFailures: 0,
      reconnectAttempt: 0,
      authorityFailures: 0,
    };
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

  const close = () => end('left');
  // RT-2.6a-arch1: the end's generation fences late tickets and sockets, and
  // a listener reacting to the final `closed` cannot reconnect a disposed store.
  function dispose() {
    if (disposed()) return;
    end('disposed');
    for (const release of [stopVisibility, topics.release, diagnostics.release])
      release();
    listeners.clear();
    lifetime.abort();
  }
  /** After disposal a registration retains nothing. */
  const live =
    <A extends unknown[]>(register: (...args: A) => () => unknown) =>
    (...args: A) =>
      disposed() ? () => {} : register(...args);

  return {
    onDiagnostic: live(diagnostics.subscribe),
    subscribeTopic: live(topics.subscribe),
    onMessage: live(topics.onMessage),
    resubscribeTopic: topics.resubscribe,
    sendObservation: (frame) => {
      if (state.progress.phase.status !== 'open' || !socket) return false;
      socket.send(JSON.stringify({ v: ENVELOPE_VERSION, ...frame }));
      return true;
    },
    connect,
    close,
    dispose,
    reportActivity: (next) =>
      activity.report(next, state.progress.phase.status === 'open'),
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
