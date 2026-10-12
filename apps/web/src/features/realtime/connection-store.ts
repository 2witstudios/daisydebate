import { createConnectionDiagnostics } from './connection-diagnostics';
import { createObservationSubscriptions } from './observation-subscriptions';
import {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  type ObservationServerMessage,
  type ServerMessage,
} from '@daisy/protocol';
import {
  createTopicSubscriptions,
  parseServerMessage,
} from './topic-subscriptions';
import { nextReconnectDelayMs } from './backoff';
import { createHeartbeat } from './heartbeat';
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

const isObservationFrame = (
  frame: ServerMessage,
): frame is ObservationServerMessage => frame.type.startsWith('observation.');

export function createConnectionStore(
  deps: ConnectionStoreDeps,
): ConnectionStore {
  const diagnostics = createConnectionDiagnostics();
  let generation = 0;
  let disposed = false;
  let status: ConnectionStatus = 'idle';
  let terminal: TerminalReason | null = null;
  let socket: WebSocketLike | null = null;
  let ticketAbort: AbortController | null = null;
  let consecutiveAuthFailures = 0;
  let reconnectAttempt = 0;
  let reconnectTimer: unknown = null;
  const listeners = new Set<(state: ConnectionState) => void>();
  const sendText = (text: string) => socket?.send(text);
  const heartbeat = createHeartbeat({
    scheduler: deps.scheduler,
    onDead: () => reapDeadSocket(generation),
  });
  const topics = createTopicSubscriptions({
    send: (frame) => {
      if (status === 'open' && socket) socket.send(JSON.stringify(frame));
    },
  });
  const observations = createObservationSubscriptions({
    now: deps.scheduler.now,
    send: (frame) => {
      if (status === 'open' && socket) socket.send(JSON.stringify(frame));
    },
  });

  const releaseVisibility = deps.onVisibilityChange((visible) => {
    if (visible && status === 'open' && socket) heartbeat.visibility(sendText);
  });

  function snapshot(): ConnectionState {
    return { status, generation, terminal };
  }
  function notify() {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }
  function clearReconnect() {
    if (reconnectTimer !== null) deps.scheduler.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  function reapDeadSocket(myGeneration: number) {
    if (myGeneration !== generation) return;
    // Half-open: reap it locally. Bumping the generation first makes this
    // socket's own listeners stale, so the synchronous close event
    // triggered below cannot also run handleClose and double-schedule a
    // reconnect.
    heartbeat.stop();
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
      heartbeat.start(() => myGeneration === generation && !!socket, sendText);
      topics.reconnect();
      observations.reconnect();
      notify();
      topics.emit(frame);
      return;
    }
    if (status !== 'open') return;
    if (isObservationFrame(frame)) {
      observations.emit(frame);
      return;
    }
    if (frame.type === 'pong') heartbeat.pong(frame.id);
    topics.emit(frame);
  }
  function handleClose(myGeneration: number, code: number) {
    if (myGeneration !== generation) return;
    heartbeat.stop();
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
    if (disposed) return;
    if (status === 'connecting' || status === 'open') return;
    generation += 1;
    const myGeneration = generation;
    status = 'connecting';
    terminal = null;
    clearReconnect();
    notify();

    const newSocket = deps.createSocket(deps.url);
    ticketAbort?.abort();
    ticketAbort = new AbortController();
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
      .fetchTicket(ticketAbort.signal)
      .then((value) => {
        if (myGeneration !== generation) return;
        ticket = value;
        diagnostics.emit(myGeneration, 'ticket-resolved');
        tryHello();
      })
      .catch((error: unknown) => fail('ticket-failed', error));
  }

  function close() {
    ticketAbort?.abort();
    ticketAbort = null;
    clearReconnect();
    heartbeat.stop();
    generation += 1;
    status = 'closed';
    terminal = null;
    consecutiveAuthFailures = 0;
    reconnectAttempt = 0;
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

  return {
    observe: observations.observe,
    onDiagnostic: diagnostics.subscribe,
    subscribeTopic: topics.subscribe,
    onMessage: topics.onMessage,
    resubscribeTopic: topics.resubscribe,
    connect,
    close,
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseVisibility();
      close();
      observations.dispose();
      listeners.clear();
    },
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
