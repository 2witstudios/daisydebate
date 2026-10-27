import type { Clock, IdGenerator } from '@daisy/clock';
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
import { operatorLimits } from '@daisy/protocol/operator';
import {
  OPERATOR_TIMEOUT_MS,
  type OperatorClient,
} from '../operator-client/client';
import { auditedOutcome, commandView, mailDetail } from './outcome';
import {
  intentAnchor,
  openCommands,
  openPendingCommand,
  resolvePendingCommand,
  type OpenCommand,
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

/**
 * Authorizes a mutation now from the operator row read now; a denial is
 * audited, and the caller signs nothing. Returns the refusal detail, or
 * null when allowed.
 */
async function updateRefusal(
  deps: CommandDeps,
  operatorId: string,
): Promise<ReturnType<typeof deniedDetail> | null> {
  const operator = await currentFact(deps, operatorId);
  const decision = operator
    ? authorizeOperator({
        operator,
        action: 'account.beta_access.update',
        policy: currentApprovalPolicy,
      })
    : ({ allowed: false, reason: 'disabled' } as const);
  if (decision.allowed) return null;
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
  return deniedDetail(decision.reason);
}

const mayUpdate = async (deps: CommandDeps, operatorId: string) =>
  (await updateRefusal(deps, operatorId)) === null;

/**
 * Audits the outcome; a settled one closes the command exactly once. True
 * when this caller recorded it, false when a racing reconciler already had.
 */
async function recordOutcome(
  deps: CommandDeps,
  command: PendingCommand,
  kind: 'command.outcome' | 'command.reconciled',
  audited: ReturnType<typeof auditedOutcome>,
): Promise<boolean> {
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    if (
      audited.settled &&
      !(await resolvePendingCommand(tx, command.commandId, now))
    )
      return false;
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
    return true;
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

/** What reconciling one command did: whether this caller settled it. */
type Reconciled =
  | { readonly kind: 'settled'; readonly recorded: boolean }
  | { readonly kind: 'open' }
  | { readonly kind: 'unreachable' };

const settledBy = (recorded: boolean): Reconciled => ({
  kind: 'settled',
  recorded,
});

/**
 * How long a NOT_FOUND read-back may still hide a PUT in flight: a signed
 * request stays valid for the participant's clock skew, and the client may
 * have given up on it after its own timeout (ISSUE-708).
 */
export const ABANDON_AFTER_MS = operatorLimits.skewMs + OPERATOR_TIMEOUT_MS;

/**
 * A command the participant has not seen: resend it under its own operator
 * only if that operator may still update. Otherwise sign nothing; once the
 * original PUT can no longer be valid, close it as abandoned, which is then
 * true, since it was never applied. Until then it stays open.
 */
async function resendOrAbandon(
  deps: CommandDeps,
  command: OpenCommand,
): Promise<Reconciled> {
  const refused = await updateRefusal(deps, command.operatorId);
  const inFlight =
    Date.parse(deps.clock.now()) - Date.parse(command.openedAt) <
    ABANDON_AFTER_MS;
  if (refused !== null && inFlight) return { kind: 'open' };
  if (refused !== null)
    return settledBy(
      await recordOutcome(deps, command, 'command.reconciled', {
        outcome: 'abandoned',
        detail: refused,
        settled: true,
      }),
    );
  const anchor = await intentAnchor(deps.db, command.commandId);
  if (anchor === null) return { kind: 'open' };
  const audited = auditedOutcome(await send(deps, command, anchor));
  const recorded = await recordOutcome(
    deps,
    command,
    'command.outcome',
    audited,
  );
  return audited.settled ? settledBy(recorded) : { kind: 'unreachable' };
}

/**
 * One open command: read it back as the viewer, who was authorized now,
 * or resend it when it never arrived. An unreadable participant is
 * unreachable, so the caller stops the batch.
 */
async function reconcileOne(
  deps: CommandDeps,
  command: OpenCommand,
  viewerId: string,
): Promise<Reconciled> {
  const read = await deps.client.readCommand(viewerId, command.commandId);
  if (read.kind === 'ok')
    return settledBy(
      await recordOutcome(deps, command, 'command.reconciled', {
        outcome: read.value.result.outcome,
        detail: mailDetail(read.value.mailState),
        settled: true,
      }),
    );
  if (read.kind === 'unknown') return { kind: 'unreachable' };
  return read.code === 'NOT_FOUND'
    ? resendOrAbandon(deps, command)
    : { kind: 'open' };
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
    const reconciled = await reconcileOne(deps, command, viewerId);
    // An unreachable participant would time out every remaining call.
    if (reconciled.kind === 'unreachable') break;
    if (reconciled.kind === 'settled' && reconciled.recorded) settled += 1;
  }
  return { settled, open: open.length - settled };
}
