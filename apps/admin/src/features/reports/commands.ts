import type { ReportOutcome } from '@daisy/protocol';
import { appendAudit } from '../../audit/store';
import {
  authorizeOperator,
  currentApprovalPolicy,
  deniedDetail,
} from '../../authorization/authorize-operator';
import { findOperator } from '../../auth/store';
import type { CommandDeps } from '../accounts/commands';

export type ReportNotice =
  'resolved' | 'lifted' | 'denied' | 'refused' | 'unknown';

/** Whether the operator row read now may act; a denial is audited. */
async function mayAct(
  deps: CommandDeps,
  operatorId: string,
  action: 'report.resolve' | 'moderation.lift',
): Promise<boolean> {
  const row = await findOperator(deps.db, operatorId);
  const decision = row
    ? authorizeOperator({
        operator: {
          id: row.id,
          role: row.role as 'owner' | 'operator',
          disabled: row.disabledAt !== null,
          revision: row.revision,
        },
        action,
        policy: currentApprovalPolicy,
      })
    : ({ allowed: false, reason: 'disabled' } as const);
  if (decision.allowed) return true;
  await deps.db.transaction((tx) =>
    appendAudit(tx, {
      id: deps.ids.next(),
      at: deps.clock.now(),
      kind: 'access.denied',
      operatorId,
      commandId: null,
      targetUserId: null,
      outcome: null,
      detail: deniedDetail(decision.reason),
    }),
  );
  return false;
}

/**
 * One operator decision (ADR 0103), audited on this side before and after it
 * is sent, with the chain head after the intent as the cross-database anchor.
 * A report closes once: an unknown outcome is safe to resend from the queue,
 * since a decision that landed takes the report off it, and a second answers
 * a refusal. So no pending-command row is kept for these.
 */
async function audited<T>(
  deps: CommandDeps,
  input: {
    readonly operatorId: string;
    readonly action: 'report.resolve' | 'moderation.lift';
    readonly decision: string;
    readonly targetUserId: string;
  },
  send: (
    commandId: string,
    anchor: string,
  ) => Promise<
    | { readonly kind: 'ok'; readonly value: T }
    | { readonly kind: 'rejected'; readonly code: string }
    | { readonly kind: 'unknown' }
  >,
  done: ReportNotice,
): Promise<ReportNotice> {
  if (!(await mayAct(deps, input.operatorId, input.action))) return 'denied';
  const commandId = deps.ids.next();
  const { hash: anchor } = await deps.db.transaction((tx) =>
    appendAudit(tx, {
      id: deps.ids.next(),
      at: deps.clock.now(),
      kind: 'command.intent',
      operatorId: input.operatorId,
      commandId,
      targetUserId: input.targetUserId,
      outcome: input.decision,
      detail: null,
    }),
  );
  const outcome = await send(commandId, anchor);
  await deps.db.transaction((tx) =>
    appendAudit(tx, {
      id: deps.ids.next(),
      at: deps.clock.now(),
      kind: 'command.outcome',
      operatorId: input.operatorId,
      commandId,
      targetUserId: input.targetUserId,
      outcome: `${input.decision}:${outcome.kind}`,
      detail: null,
    }),
  );
  if (outcome.kind === 'ok') return done;
  return outcome.kind === 'rejected' ? 'refused' : 'unknown';
}

export const resolveReport = (
  deps: CommandDeps,
  input: {
    readonly operatorId: string;
    readonly reportId: string;
    readonly subjectUserId: string;
    readonly resolution:
      | { readonly outcome: Exclude<ReportOutcome, 'suspended'> }
      | { readonly outcome: 'suspended'; readonly suspendDays: number };
  },
) =>
  audited(
    deps,
    {
      operatorId: input.operatorId,
      action: 'report.resolve',
      decision: `report.resolve:${input.resolution.outcome}`,
      targetUserId: input.subjectUserId,
    },
    (commandId, adminAuditHead) =>
      deps.client.resolveReport(input.operatorId, input.reportId, {
        v: 1,
        commandId,
        ...input.resolution,
        adminAuditHead,
      }),
    'resolved',
  );

export const liftRestriction = (
  deps: CommandDeps,
  input: {
    readonly operatorId: string;
    readonly actionId: string;
    readonly userId: string;
  },
) =>
  audited(
    deps,
    {
      operatorId: input.operatorId,
      action: 'moderation.lift',
      decision: 'moderation.lift',
      targetUserId: input.userId,
    },
    (commandId, adminAuditHead) =>
      deps.client.liftModeration(input.operatorId, input.actionId, {
        v: 1,
        commandId,
        adminAuditHead,
      }),
    'lifted',
  );
