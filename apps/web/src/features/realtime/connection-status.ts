import type { TerminalReason } from './close-code-policy';

/**
 * Why a connection is down with nothing scheduled: the user left (logout),
 * the store was disposed for good, or the server gave a reason that forbids
 * retrying.
 */
export type ClosedWhy = 'left' | 'disposed' | TerminalReason;

/**
 * Where one tab's realtime connection is. `ticketing`: the socket is being
 * opened and the ticket fetched, and hello has not been sent. `handshaking`:
 * hello is sent and `ready` is awaited. `reconnecting`: down, with a retry
 * scheduled. `closed`: down, and nothing is scheduled.
 */
export type ConnectionPhase =
  | { readonly status: 'idle' }
  | { readonly status: 'ticketing' }
  | { readonly status: 'handshaking' }
  | { readonly status: 'open' }
  | { readonly status: 'reconnecting' }
  | { readonly status: 'closed'; readonly why: ClosedWhy };

export type ConnectionEvent =
  | { readonly type: 'connect-asked' }
  | { readonly type: 'hello-sent' }
  | { readonly type: 'ready' }
  /** The socket closed under us; `terminal` is the close decision's verdict. */
  | { readonly type: 'socket-closed'; readonly terminal: TerminalReason | null }
  /** An open socket stopped answering pings and was closed locally. */
  | { readonly type: 'socket-reaped' }
  | { readonly type: 'left' }
  | { readonly type: 'disposed' };

const isDisposed = (phase: ConnectionPhase) =>
  phase.status === 'closed' && phase.why === 'disposed';

const hasSocket = (phase: ConnectionPhase) =>
  phase.status === 'ticketing' ||
  phase.status === 'handshaking' ||
  phase.status === 'open';

type Move<Type extends ConnectionEvent['type']> = (
  phase: ConnectionPhase,
  event: Extract<ConnectionEvent, { readonly type: Type }>,
) => ConnectionPhase;

const moves: { readonly [Type in ConnectionEvent['type']]: Move<Type> } = {
  'connect-asked': (phase) =>
    hasSocket(phase) ? phase : { status: 'ticketing' },
  'hello-sent': (phase) =>
    phase.status === 'ticketing' ? { status: 'handshaking' } : phase,
  ready: (phase) =>
    phase.status === 'handshaking' ? { status: 'open' } : phase,
  'socket-closed': (phase, event) => {
    if (!hasSocket(phase)) return phase;
    return event.terminal === null
      ? { status: 'reconnecting' }
      : { status: 'closed', why: event.terminal };
  },
  'socket-reaped': (phase) =>
    phase.status === 'open' ? { status: 'reconnecting' } : phase,
  left: (phase) =>
    phase.status === 'closed' && phase.why === 'left'
      ? phase
      : { status: 'closed', why: 'left' },
  disposed: () => ({ status: 'closed', why: 'disposed' }),
};

/**
 * The connection's next phase. An event that does not apply where the
 * connection is returns the same phase object, and nothing leaves disposal.
 */
export function nextConnectionPhase(
  phase: ConnectionPhase,
  event: ConnectionEvent,
): ConnectionPhase {
  if (isDisposed(phase)) return phase;
  return (moves[event.type] as Move<typeof event.type>)(phase, event);
}

/** The server's reason this connection may not retry, if that is why it is down. */
export function terminalReason(phase: ConnectionPhase): TerminalReason | null {
  return phase.status === 'closed' &&
    phase.why !== 'left' &&
    phase.why !== 'disposed'
    ? phase.why
    : null;
}
