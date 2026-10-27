import type { Clock, IdGenerator } from '@daisy/clock';
import type { BetaAccessCommandResult } from '@daisy/protocol';
import { appendAudit } from '../../audit/store';
import type { AuditEvent } from '../../audit/chain';
import { findOperator } from '../../auth/store';
import {
  authorizeOperator,
  currentApprovalPolicy,
  deniedDetail,
  type OperatorFact,
} from '../../authorization/authorize-operator';
import type { AdminDatabase } from '../../db/client';
import type { OperatorCall, OperatorClient } from '../operator-client/client';
import { auditedOutcome, commandView, mailDetail } from './outcome';
import {
  intentAnchor,
  openCommands,
  openPendingCommand,
  resolvePendingCommand,
  type PendingCommand,
} from './store';

/**
 * Approve and revoke (ADR 0077 amendment, plan §7). Each command is
 * authorized against the operator row read now, never the page's copy; its
 * id is minted and its intent written before anything is sent; and the PUT
 * carries the chain head after that intent as the cross-database anchor.
 * An unknown outcome stays open until reconciliation reads it back, or,
 * when the participant app never saw it, resends it under the same id.
 */
export type CommandDeps = {
  readonly db: AdminDatabase;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly client: OperatorClient;
};

type Event = Omit<AuditEvent, 'id' | 'at'>;

const record = (deps: CommandDeps, event: Event, now: string) =>
  deps.db.transaction((tx) =>
    appendAudit(tx, { ...event, id: deps.ids.next(), at: now }),
  );

/** The operator as the database holds it now; null when gone. */
async function currentFact(
  deps: CommandDeps,
  operatorId: string,
): Promise<OperatorFact | null> {
  const row = await findOperator(deps.db, operatorId);
  return (
    row && {
      id: row.id,
      role: row.role as OperatorFact['role'],
      disabled: row.disabledAt !== null,
      revision: row.revision,
    }
  );
}

/** Authorizes a mutation now; a denial is audited and nothing is sent. */
async function mayUpdate(
  deps: CommandDeps,
  operatorId: string,
): Promise<boolean> {
  const operator = await currentFact(deps, operatorId);
  const decision = operator
    ? authorizeOperator({
        operator,
        action: 'account.beta_access.update',
        policy: currentApprovalPolicy,
      })
    : ({ allowed: false, reason: 'disabled' } as const);
  if (decision.allowed) return true;
  await record(
    deps,
    {
      kind: 'access.denied',
      operatorId,
      commandId: null,
      targetUserId: null,
      outcome: null,
      detail: deniedDetail(decision.reason),
    },
    deps.clock.now(),
  );
  return false;
}

/** Audits the outcome; a settled one closes the command exactly once. */
async function recordOutcome(
  deps: CommandDeps,
  command: PendingCommand,
  kind: 'command.outcome' | 'command.reconciled',
  audited: ReturnType<typeof auditedOutcome>,
): Promise<void> {
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    if (
      audited.settled &&
      !(await resolvePendingCommand(tx, command.commandId, now))
    )
      return;
    await appendAudit(tx, {
      id: deps.ids.next(),
      kind,
      operatorId: command.operatorId,
      commandId: command.commandId,
      targetUserId: command.targetUserId,
      outcome: audited.outcome,
      detail: audited.detail,
      at: now,
    });
  });
}

const send = (deps: CommandDeps, command: PendingCommand, anchor: string) =>
  deps.client.setBetaAccess(command.operatorId, command.targetUserId, {
    v: 1,
    commandId: command.commandId,
    state: command.desiredState,
    expectedRevision: command.expectedRevision,
    adminAuditHead: anchor,
  });

export async function submitBetaAccess(
  deps: CommandDeps,
  input: Omit<PendingCommand, 'commandId'>,
): Promise<ReturnType<typeof commandView> | { readonly notice: 'denied' }> {
  if (!(await mayUpdate(deps, input.operatorId))) return { notice: 'denied' };
  const command = { ...input, commandId: deps.ids.next() };
  const now = deps.clock.now();
  const intent = await deps.db.transaction(async (tx) => {
    await openPendingCommand(tx, { ...command, now });
    return appendAudit(tx, {
      id: deps.ids.next(),
      kind: 'command.intent',
      operatorId: command.operatorId,
      commandId: command.commandId,
      targetUserId: command.targetUserId,
      outcome: null,
      detail: command.desiredState,
      at: now,
    });
  });
  const call = await send(deps, command, intent.hash);
  await recordOutcome(deps, command, 'command.outcome', auditedOutcome(call));
  return commandView(call);
}

/** One open command: read it back, or resend it when it never arrived. */
async function reconcileOne(
  deps: CommandDeps,
  command: PendingCommand,
): Promise<OperatorCall<BetaAccessCommandResult> | null> {
  const read = await deps.client.readCommand(
    command.operatorId,
    command.commandId,
  );
  if (read.kind === 'ok') {
    await recordOutcome(deps, command, 'command.reconciled', {
      outcome: read.value.result.outcome,
      detail: mailDetail(read.value.mailState),
      settled: true,
    });
    return { kind: 'ok', value: read.value.result };
  }
  if (read.kind !== 'rejected' || read.code !== 'NOT_FOUND') return null;
  const anchor = await intentAnchor(deps.db, command.commandId);
  if (anchor === null) return null;
  const call = await send(deps, command, anchor);
  await recordOutcome(deps, command, 'command.outcome', auditedOutcome(call));
  return call;
}

export const RECONCILE_BATCH = 20;

/** Settles what it can of the open commands; returns how many stay open. */
export async function reconcileOpenCommands(
  deps: CommandDeps,
  viewerId: string,
): Promise<{ readonly settled: number; readonly open: number }> {
  const open = await openCommands(deps.db, RECONCILE_BATCH);
  if (open.length === 0 || !(await mayUpdate(deps, viewerId)))
    return { settled: 0, open: open.length };
  let settled = 0;
  for (const command of open) {
    const call = await reconcileOne(deps, command);
    if (call && auditedOutcome(call).settled) settled += 1;
  }
  return { settled, open: open.length - settled };
}
