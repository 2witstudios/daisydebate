import { hostAllowed, MISDIRECTED_STATUS, sameOrigin } from '../auth/origin';

/**
 * The admin server's first check on every request, static files included
 * (ADR 0077): a Host other than the canonical `localhost:4800`, or a
 * state-changing request whose Origin is not the canonical origin, is
 * answered 421 before Next sees it. Server actions repeat the Origin check.
 * The peer address is the socket's, written into a header the server owns;
 * whatever a client sent under that name is dropped.
 */
export const PEER_HEADER = 'x-daisy-admin-peer';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

export type GateDecision =
  | { readonly admit: true; readonly peer: string }
  | { readonly admit: false; readonly status: number };

const originAllowed = (method: string | undefined, origin?: string) =>
  SAFE_METHODS.has(method ?? '') || sameOrigin(origin);

export const gateRequest = (input: {
  readonly host: string | undefined;
  readonly method: string | undefined;
  readonly origin: string | undefined;
  readonly socketAddress: string | undefined;
}): GateDecision =>
  hostAllowed(input.host) && originAllowed(input.method, input.origin)
    ? { admit: true, peer: input.socketAddress ?? 'unknown' }
    : { admit: false, status: MISDIRECTED_STATUS };
