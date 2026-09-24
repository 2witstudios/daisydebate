import type { ReconnectKind } from './backoff';

/**
 * The per-close-code client reaction (ADR 0031 §8): a pure decision from a
 * close code and how many *consecutive* 4001s preceded it (reset to 0 on
 * every successful `ready`, by the caller). `AUTH_FAILURE_LIMIT` matches the
 * table's "after 3 consecutive failures, stop and show signed-out state":
 * this decision is for the 3rd failure itself, so it fires once
 * `consecutiveAuthFailures` (the count *before* this one) reaches 2.
 */
const AUTH_FAILURE_LIMIT = 3;

export type TerminalReason = 'revoked' | 'unsupported' | 'signed-out';

export type CloseDecision =
  | {
      readonly reconnect: true;
      readonly refreshTicket: boolean;
      readonly backoffKind: ReconnectKind;
      readonly terminal: null;
    }
  | {
      readonly reconnect: false;
      readonly refreshTicket: false;
      readonly backoffKind: null;
      readonly terminal: TerminalReason;
    };

function reconnect(
  backoffKind: ReconnectKind,
  refreshTicket: boolean,
): CloseDecision {
  return { reconnect: true, refreshTicket, backoffKind, terminal: null };
}
function stop(terminal: TerminalReason): CloseDecision {
  return {
    reconnect: false,
    refreshTicket: false,
    backoffKind: null,
    terminal,
  };
}

export function decideOnClose({
  code,
  consecutiveAuthFailures,
}: {
  readonly code: number;
  readonly consecutiveAuthFailures: number;
}): CloseDecision {
  switch (code) {
    case 4001:
      return consecutiveAuthFailures + 1 >= AUTH_FAILURE_LIMIT
        ? stop('signed-out')
        : reconnect('standard', true);
    case 4002:
      return stop('revoked');
    case 4003:
      return stop('unsupported');
    case 4004:
      return reconnect('rate-limited', false);
    case 4005:
      return reconnect('standard', false);
    case 4006:
      return reconnect('immediate', false);
    default:
      // 1000, 1001, 1006 and any unrecognized code (treated as 1006).
      return reconnect('standard', false);
  }
}
