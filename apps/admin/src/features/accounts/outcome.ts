import type { BetaAccessCommandResult } from '@daisy/protocol';
import type { AuditDetail } from '../../audit/chain';
import type { OperatorCommandState } from '@daisy/protocol/operator';
import type { OperatorCall } from '../operator-client/client';

/**
 * How one call's outcome is audited and shown (ADR 0077 amendment). Only a
 * result or a definite refusal settles a command; `unknown` leaves it open
 * for reconciliation and is never shown as a failure.
 */
type CommandCall = OperatorCall<BetaAccessCommandResult>;

export type AuditedOutcome = {
  readonly outcome: string;
  readonly detail: AuditDetail | null;
  readonly settled: boolean;
};

export const mailDetail = (
  state: OperatorCommandState['mailState'],
): AuditDetail =>
  state === null
    ? 'mail_none'
    : state === 'leased'
      ? 'mail_queued'
      : `mail_${state}`;

export function auditedOutcome(call: CommandCall): AuditedOutcome {
  switch (call.kind) {
    case 'ok':
      return {
        outcome: call.value.outcome,
        detail: call.value.mail === 'queued' ? 'mail_queued' : 'mail_none',
        settled: true,
      };
    case 'rejected':
      return { outcome: `rejected:${call.code}`, detail: null, settled: true };
    case 'unknown':
      return { outcome: 'unknown', detail: null, settled: false };
  }
}

export const commandNotices = [
  'changed',
  'unchanged',
  'conflict',
  'refused',
  'unknown',
  'denied',
  'reconciled',
  'unconfigured',
] as const;
export type CommandNotice = (typeof commandNotices)[number];

export function commandView(call: CommandCall): {
  readonly notice: CommandNotice;
  readonly mail: 'queued' | 'none' | null;
} {
  if (call.kind === 'ok')
    return { notice: call.value.outcome, mail: call.value.mail };
  if (call.kind === 'unknown') return { notice: 'unknown', mail: null };
  return {
    notice: call.code === 'CONFLICT' ? 'conflict' : 'refused',
    mail: null,
  };
}
