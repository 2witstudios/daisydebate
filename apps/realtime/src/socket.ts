import type { ServerWebSocket } from 'bun';
import type { Logger } from '@daisy/logger';
import {
  clientMessageSchema,
  ENVELOPE_VERSION,
  serverMessageSchema,
  type ServerMessage,
} from '@daisy/protocol';
import type {
  SocketPrincipal,
  SubscriptionRegistry,
  RegistryConnection,
} from './registry';
import type { AdmissionReservation } from './admission';
import { closeFor, evaluateFirstMessage } from './handlers/hello';

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
};
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
  cause: 'hello_timeout' | 'message_rejected',
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
}) {
  function reject(
    ws: ServerWebSocket<SocketData>,
    reason: Parameters<typeof closeFor>[0],
    cause: 'hello_timeout' | 'message_rejected' = 'message_rejected',
  ) {
    if (ws.data.phase === 'closed') return;
    ws.data.phase = 'closed';
    clearHelloTimer(ws, timers);
    if (ws.data.connection) registry?.remove(ws.data.connection);
    ws.data.admission?.release();
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
    let principal;
    try {
      principal = await authenticate(outcome.ticket, ws.data.origin);
    } catch {
      principal = null;
    }
    if (ws.data.phase !== 'authenticating') return;
    if (!principal || helloExpired(ws)) {
      reject(ws, 'auth_failed');
      return;
    }
    acceptHello(ws, principal);
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
          send: (frame) => send(ws, frame),
          subscribe: (topic) => {
            ws.subscribe(topic);
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
    send(ws, { v: ENVELOPE_VERSION, type: 'ready' });
  }
  async function receiveAuthenticated(
    ws: ServerWebSocket<SocketData>,
    message: string,
  ) {
    const frame = parseFrame(ws, message);
    if (!frame) return;
    if (!(await currentPrincipal(ws))) return;
    if (frame.type === 'ping')
      send(ws, { v: ENVELOPE_VERSION, type: 'pong', id: frame.id });
    else if (frame.type === 'subscribe' && ws.data.connection)
      await registry?.subscribe(ws.data.connection, frame);
    else if (frame.type === 'unsubscribe' && ws.data.connection)
      registry?.unsubscribe(ws.data.connection, frame);
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
    let valid = false;
    try {
      valid = await validatePrincipal(ws.data.principal);
    } catch {
      valid = false;
    }
    if (ws.data.phase !== 'authenticated') return false;
    if (!valid) reject(ws, 'revoked');
    return valid;
  }
  return {
    open(ws: ServerWebSocket<SocketData>) {
      ws.data.phase = 'awaiting';
      ws.data.helloDeadline = now() + HELLO_TIMEOUT_MS;
      ws.data.helloTimer = timers.setTimeout(() => {
        ws.data.helloTimer = undefined;
        reject(ws, 'auth_failed', 'hello_timeout');
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
    close(ws: ServerWebSocket<SocketData>) {
      ws.data.phase = 'closed';
      clearHelloTimer(ws, timers);
      if (ws.data.connection) registry?.remove(ws.data.connection);
      ws.data.admission?.release();
    },
  };
}
