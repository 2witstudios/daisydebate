import { hostAllowed, MISDIRECTED_STATUS } from '../auth/origin';

/**
 * The admin server's first check on every request, static files included
 * (ADR 0076): a Host other than the canonical `localhost:4800` is answered
 * 421 before Next sees it. The peer address is the socket's, written into a
 * header the server owns; whatever a client sent under that name is dropped.
 */
export const PEER_HEADER = 'x-daisy-admin-peer';

export type GateDecision =
  | { readonly admit: true; readonly peer: string }
  | { readonly admit: false; readonly status: number };

export const gateRequest = (input: {
  readonly host: string | undefined;
  readonly socketAddress: string | undefined;
}): GateDecision =>
  hostAllowed(input.host)
    ? { admit: true, peer: input.socketAddress ?? 'unknown' }
    : { admit: false, status: MISDIRECTED_STATUS };
