import type { ServerWebSocket } from 'bun';
import type { Logger } from '@daisy/logger';
import {
  clientMessageSchema,
  ENVELOPE_VERSION,
  serverMessageSchema,
  type PresenceActivity,
  type ServerMessage,
} from '@daisy/protocol';
import type {
  SocketPrincipal,
  SubscriptionRegistry,
  RegistryConnection,
} from './registry';
import type { AdmissionReservation } from './admission';
import { closeFor, evaluateFirstMessage } from './handlers/hello';
import type { PresenceSession, PresenceTracker } from './presence';
import type {
  ObservationConnection,
  ObservationNode,
} from './observation/node';

/** ADR 0031 §11.5: the first message must arrive within 5s or the socket closes 4001. */
export const HELLO_TIMEOUT_MS = 5_000;

export type SocketData = {
  origin?: string;
  admission?: AdmissionReservation;
  phase?: 'awaiting' | 'authenticating' | 'authenticated' | 'closed';
  helloDeadline?: number;
  principal?: SocketPrincipal;
  connection?: RegistryConnection;
  helloTimer?: ReturnType<typeof setTimeout> | undefined;
  presence?: PresenceSession | undefined;
  observer?: ObservationConnection | undefined;
  /** Settles when every frame received so far has taken effect. */
  frameTurn?: Promise<void>;
  queuedFrames?: number;
};
/** About a second of frames at the admission rate; a normal client queues a few. */
const MAX_QUEUED_FRAMES = 64;
export type SocketTimers = {
  readonly setTimeout: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
};
const systemTimers: SocketTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

const clearHelloTimer = (
  ws: ServerWebSocket<SocketData>,
  timers: SocketTimers,
) => {
  if (ws.data.helloTimer === undefined) return;
  timers.clearTimeout(ws.data.helloTimer);
  ws.data.helloTimer = undefined;
};

const logRejection = (
  logger: Logger,
  cause: 'hello_timeout' | 'message_rejected' | 'check_unanswered',
  code: number,
  reason: string,
) =>
  logger.log(
    'realtime.connection.rejected',
    { closeCode: code, closeReason: reason, cause },
    'Connection rejected',
  );

/**
 * Wires ADR 0031's socket lifecycle: arm the hello deadline on open, decide
 * consume a real ticket before ready, authorize subsequent frames against
 * the current durable session, and always clear owned resources on close.
 */
export function createWebSocketHandlers({
  logger,
  timers = systemTimers,
  now = () => performance.now(),
  authenticate,
  registry,
  validatePrincipal,
  failed,
  presence,
  observation,
}: {
  readonly logger: Logger;
  readonly timers?: SocketTimers;
  readonly now?: () => number;
  readonly authenticate?: (
    ticket: string,
    origin: string,
  ) => Promise<SocketPrincipal | null>;
  readonly registry?: SubscriptionRegistry;
  readonly validatePrincipal?: (principal: SocketPrincipal) => Promise<boolean>;
  /** Reports a hello or frame check that failed rather than answered. */
  readonly failed?: (error: unknown, operation: string) => void;
  readonly presence?: PresenceTracker;
  readonly observation?: ObservationNode;
}) {
  /** Closes the socket's phase and frees everything it owns, once or again. */
  function release(ws: ServerWebSocket<SocketData>) {
    ws.data.phase = 'closed';
    clearHelloTimer(ws, timers);
    if (ws.data.connection) registry?.remove(ws.data.connection);
    if (ws.data.observer) observation?.disconnect(ws.data.observer);
    ws.data.observer = undefined;
    ws.data.presence?.stop();
    ws.data.presence = undefined;
    ws.data.admission?.release();
  }
  function reject(
    ws: ServerWebSocket<SocketData>,
    reason: Parameters<typeof closeFor>[0],
    cause: Parameters<typeof logRejection>[1] = 'message_rejected',
  ) {
    if (ws.data.phase === 'closed') return;
    release(ws);
    const outcome = closeFor(reason);
    logRejection(logger, cause, outcome.code, outcome.reason);
    ws.close(outcome.code, outcome.reason);
  }
  function send(ws: ServerWebSocket<SocketData>, frame: ServerMessage) {
    if (ws.data.phase === 'closed') return;
    const text = JSON.stringify(serverMessageSchema.parse(frame));
    if (ws.send(text) === 0 || ws.getBufferedAmount() > 262_144)
      reject(ws, 'slow_consumer');
  }
  async function receiveHello(
    ws: ServerWebSocket<SocketData>,
    message: string,
  ) {
    if (ws.data.phase === 'authenticating') {
      reject(ws, 'auth_failed');
      return;
    }
    const outcome = evaluateFirstMessage(message);
    if ('code' in outcome) {
      reject(ws, outcome.reason);
      return;
    }
    if (!authenticate || !ws.data.origin || helloExpired(ws)) {
      reject(ws, 'auth_failed');
      return;
    }
    ws.data.phase = 'authenticating';
    settleHello(
      ws,
      await authenticate(outcome.ticket, ws.data.origin).catch((error) => {
        failed?.(error, 'realtime.hello');
        return 'unavailable' as const;
      }),
    );
  }
  /** A check that could not answer decided nothing, so it is not a failed authentication. */
  function settleHello(
    ws: ServerWebSocket<SocketData>,
    principal: SocketPrincipal | null | 'unavailable',
  ) {
    if (ws.data.phase !== 'authenticating') return;
    if (!principal) reject(ws, 'auth_failed');
    else if (principal === 'unavailable')
      reject(ws, 'authority_unavailable', 'check_unanswered');
    else if (helloExpired(ws))
      reject(ws, 'authority_unavailable', 'hello_timeout');
    else acceptHello(ws, principal);
  }
  function helloExpired(ws: ServerWebSocket<SocketData>) {
    return now() >= (ws.data.helloDeadline ?? 0);
  }
  function acceptHello(
    ws: ServerWebSocket<SocketData>,
    principal: SocketPrincipal,
  ) {
    if (
      ws.data.admission &&
      !ws.data.admission.authenticate(principal.actorId)
    ) {
      reject(ws, 'rate_limited');
      return;
    }
    clearHelloTimer(ws, timers);
    ws.data.principal = principal;
    ws.data.phase = 'authenticated';
    if (registry)
      ws.data.connection = registry.add(
        {
          bufferedAmount: () => ws.getBufferedAmount(),
          send: (frame) => send(ws, frame),
          subscribe: (topic) => {
            if (!ws.subscribe(topic)) reject(ws, 'slow_consumer');
          },
          unsubscribe: (topic) => {
            ws.unsubscribe(topic);
          },
          close: (code, reason) => {
            ws.data.phase = 'closed';
            ws.close(code, reason);
          },
        },
        principal,
      );
    // Observation frames are encoded once per revision and sent as text.
    ws.data.observer = {
      principal,
      sendText: (text) => {
        if (ws.data.phase === 'closed') return false;
        if (ws.send(text) === 0 || ws.getBufferedAmount() > 262_144) {
          reject(ws, 'slow_consumer');
          return false;
        }
        return true;
      },
    };
    send(ws, { v: ENVELOPE_VERSION, type: 'ready' });
  }
  /**
   * Frames on one socket take effect in arrival order: each waits its turn for
   * its principal check and its effect, so a later frame's faster check can't
   * overtake (ISSUE-1018). A ping changes nothing, so it answers from its own
   * check at once and a slow turn can't miss the heartbeat. The queue is
   * bounded, and a client over it reconnects and resyncs; a frame that throws
   * is reported and frees the next.
   */
  function receiveAuthenticated(
    ws: ServerWebSocket<SocketData>,
    message: string,
  ) {
    const frame = parseFrame(ws, message);
    if (!frame) return;
    if (frame.type === 'ping') return answerPing(ws, frame.id);
    if ((ws.data.queuedFrames ?? 0) >= MAX_QUEUED_FRAMES) {
      reject(ws, 'rate_limited');
      return;
    }
    ws.data.queuedFrames = (ws.data.queuedFrames ?? 0) + 1;
    const turn = (ws.data.frameTurn ?? Promise.resolve()).then(async () => {
      try {
        if (ws.data.phase === 'authenticated') await takeEffect(ws, frame);
      } catch (error) {
        failed?.(error, 'realtime.frame');
      } finally {
        ws.data.queuedFrames = (ws.data.queuedFrames ?? 1) - 1;
      }
    });
    ws.data.frameTurn = turn;
    return turn;
  }
  async function answerPing(ws: ServerWebSocket<SocketData>, id: string) {
    if (await currentPrincipal(ws))
      send(ws, { v: ENVELOPE_VERSION, type: 'pong', id });
  }
  async function takeEffect(
    ws: ServerWebSocket<SocketData>,
    frame: Exclude<
      NonNullable<ReturnType<typeof parseFrame>>,
      { type: 'ping' }
    >,
  ) {
    if (!(await currentPrincipal(ws))) return;
    if (frame.type === 'presence.activity') reportActivity(ws, frame.activity);
    else if (frame.type === 'observe' || frame.type === 'unobserve')
      receiveObservation(ws, frame);
    else await receiveSubscription(ws, frame);
  }
  /**
   * Only a socket that reports activity holds a presence lease (ADR 0072):
   * a room's or a conversation's socket is transport, not the member's
   * activity, so it never keeps them online.
   */
  function reportActivity(
    ws: ServerWebSocket<SocketData>,
    activity: PresenceActivity,
  ) {
    if (ws.data.presence) ws.data.presence.activity(activity);
    else if (ws.data.principal)
      ws.data.presence = presence?.start(ws.data.principal.actorId, activity);
  }
  async function receiveSubscription(
    ws: ServerWebSocket<SocketData>,
    frame: Extract<
      NonNullable<ReturnType<typeof parseFrame>>,
      { type: 'subscribe' | 'unsubscribe' }
    >,
  ) {
    if (!ws.data.connection) return;
    if (frame.type === 'subscribe')
      await registry?.subscribe(ws.data.connection, frame);
    else registry?.unsubscribe(ws.data.connection, frame);
  }
  /** A refused observe (bounds, unknown kind, no node) is a retryable unavailability, not denial. */
  function receiveObservation(
    ws: ServerWebSocket<SocketData>,
    frame: Extract<
      NonNullable<ReturnType<typeof parseFrame>>,
      { type: 'observe' | 'unobserve' }
    >,
  ) {
    const observer = ws.data.observer;
    if (!observer) return;
    if (frame.type === 'unobserve') {
      observation?.unobserve(observer, frame.resource);
      return;
    }
    if (!observation?.observe(observer, frame))
      send(ws, {
        v: ENVELOPE_VERSION,
        type: 'observation.state',
        id: frame.id,
        resource: frame.resource,
        generation: 0,
        state: 'unavailable',
      });
  }
  function parseFrame(ws: ServerWebSocket<SocketData>, message: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      reject(ws, 'protocol_unsupported');
      return null;
    }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success || result.data.type === 'hello') {
      reject(ws, 'protocol_unsupported');
      return null;
    }
    return result.data;
  }
  async function currentPrincipal(ws: ServerWebSocket<SocketData>) {
    if (!validatePrincipal || !ws.data.principal) return true;
    let valid: boolean | 'unavailable';
    try {
      valid = await validatePrincipal(ws.data.principal);
    } catch (error) {
      failed?.(error, 'realtime.frame');
      valid = 'unavailable';
    }
    if (ws.data.phase !== 'authenticated') return false;
    // Fail closed either way; only a definite answer is a revocation.
    if (valid === 'unavailable')
      reject(ws, 'authority_unavailable', 'check_unanswered');
    else if (!valid) reject(ws, 'revoked');
    return valid === true;
  }
  return {
    open(ws: ServerWebSocket<SocketData>) {
      ws.data.phase = 'awaiting';
      ws.data.helloDeadline = now() + HELLO_TIMEOUT_MS;
      ws.data.helloTimer = timers.setTimeout(() => {
        ws.data.helloTimer = undefined;
        // A hello already being checked was sent in time: the check is slow.
        reject(
          ws,
          ws.data.phase === 'authenticating'
            ? 'authority_unavailable'
            : 'auth_failed',
          'hello_timeout',
        );
      }, HELLO_TIMEOUT_MS);
    },
    async message(ws: ServerWebSocket<SocketData>, message: string | Buffer) {
      if (ws.data.phase === 'closed') return;
      if (ws.data.admission && !ws.data.admission.inbound()) {
        reject(ws, 'rate_limited');
        return;
      }
      if (typeof message !== 'string') {
        reject(ws, 'protocol_unsupported');
        return;
      }
      if (ws.data.phase !== 'authenticated') return receiveHello(ws, message);
      return receiveAuthenticated(ws, message);
    },
    close: release,
  };
}
