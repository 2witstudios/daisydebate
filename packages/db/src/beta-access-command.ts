import { createAppError } from '@daisy/errors';
import {
  betaAccessCommandResultSchema,
  type BetaAccessCommandResult,
  type BetaAccessState,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { lockAuthorizationActors } from './authorization';
import type { authorizationAccountFact } from './authorization-account';
import type { DatabaseEventSink } from './instrumented';
import { appendSessionRevokedFor } from './session-revoked';

type Transaction = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];
type AccountFact = NonNullable<ReturnType<typeof authorizationAccountFact>>;

/** The pure decision and authority, injected so this adapter decides nothing itself. */
export type BetaAccessCommandInput = {
  readonly commandId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly targetUserId: string;
  readonly desired: 'approved' | 'revoked';
  readonly expectedRevision: number;
  /** SHA3-256 of the command's semantic identity (ADR 0079). */
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly nextId: () => string;
  readonly authorize: (target: AccountFact | null) => boolean;
  readonly decide: (
    current: {
      readonly state: BetaAccessState;
      readonly revision: number;
    } | null,
    ageBand: AccountFact['ageBand'],
  ) =>
    | {
        readonly kind: 'changed';
        readonly from: BetaAccessState;
        readonly to: 'approved' | 'revoked';
        readonly revision: number;
      }
    | {
        readonly kind: 'unchanged';
        readonly state: BetaAccessState;
        readonly revision: number;
      }
    | {
        readonly kind: 'refused';
        readonly reason: 'not-found' | 'stale' | 'age-required';
      };
};

export type BetaAccessCommandOutcome =
  | { readonly kind: 'applied'; readonly result: BetaAccessCommandResult }
  | { readonly kind: 'replayed'; readonly result: BetaAccessCommandResult };

type Decision = ReturnType<BetaAccessCommandInput['decide']>;
type Applied = Exclude<Decision, { kind: 'refused' }>;

const refusalCode = {
  stale: 'CONFLICT',
  'not-found': 'NOT_FOUND',
  // ISSUE-664: approval needs a durable 16+ age record first.
  'age-required': 'INVARIANT',
} as const;

/** The target's account fact, locked under the account fence; null without a human actor. */
async function lockTarget(tx: Transaction, userId: string) {
  const [actor] = (await tx.execute(
    sql`select id from actors where user_id = ${userId} and kind = 'human'`,
  )) as unknown as { id: string }[];
  if (!actor) return null;
  const [fact] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  return fact ?? null;
}

/** A stored receipt's result for the same digest; a different digest conflicts. */
async function storedResult(tx: Transaction, input: BetaAccessCommandInput) {
  const [receipt] = (await tx.execute(sql`select request_digest, result
    from operator_command_receipts where command_id = ${input.commandId}`)) as unknown as {
    request_digest: string;
    result: unknown;
  }[];
  if (!receipt) return null;
  if (receipt.request_digest !== input.requestDigest)
    throw createAppError('CONFLICT');
  return betaAccessCommandResultSchema.parse(receipt.result);
}

const liveTarget = (fact: AccountFact | null, userId: string) =>
  fact !== null && !fact.erased && fact.userId === userId;

/** The transition the fresh fact allows; a refusal throws and writes nothing. */
function decided(
  input: BetaAccessCommandInput,
  fact: AccountFact | null,
): Applied {
  if (!liveTarget(fact, input.targetUserId)) throw createAppError('NOT_FOUND');
  if (!input.authorize(fact)) throw createAppError('AUTHORIZATION');
  const decision = input.decide(fact!.beta, fact!.ageBand);
  if (decision.kind === 'refused')
    throw createAppError(refusalCode[decision.reason]);
  return decision;
}

const commandResult = (
  commandId: string,
  decision: Applied,
): BetaAccessCommandResult =>
  decision.kind === 'changed'
    ? {
        commandId,
        outcome: 'changed',
        accessState: decision.to,
        accessRevision: decision.revision,
        mail: decision.to === 'approved' ? 'queued' : 'none',
      }
    : {
        commandId,
        outcome: 'unchanged',
        accessState: decision.state,
        accessRevision: decision.revision,
        mail: 'none',
      };

/** State, revision, audit event and the owed mail or revocation push. */
async function applyChange(
  tx: Transaction,
  input: BetaAccessCommandInput,
  decision: Extract<Decision, { kind: 'changed' }>,
  eventSink: DatabaseEventSink | undefined,
) {
  const principal = `operator:${input.serviceId}/${input.operatorRef}`;
  await tx.execute(sql`update account_beta_access set state = ${decision.to},
      revision = ${decision.revision}, decided_at = now()
    where user_id = ${input.targetUserId}`);
  // The account fact's revision moves, so live realtime sessions re-check.
  await tx.execute(
    sql`update users set version = version + 1 where id = ${input.targetUserId}`,
  );
  await tx.execute(sql`insert into account_access_events
      (id, user_id, command_id, from_state, to_state, revision, principal)
    values (${input.nextId()}, ${input.targetUserId}, ${input.commandId},
      ${decision.from}, ${decision.to}, ${decision.revision}, ${principal})`);
  if (decision.to === 'approved')
    await tx.execute(sql`insert into mail_intents
        (id, purpose, recipient_user_id, dedupe_key, next_attempt_at)
      values (${input.nextId()}, 'beta-approved', ${input.targetUserId},
        ${`beta-approved:${input.commandId}`}, now())`);
  else
    await appendSessionRevokedFor(
      tx,
      input.targetUserId,
      eventSink,
      'runBetaAccessCommand',
    );
}

/**
 * One beta access command inside its transaction, under the target's
 * account fence: the receipt first (the same digest replays the stored
 * result), then authority and the transition on the fresh fact, then
 * state, audit event, owed mail or revocation push and the receipt.
 */
export async function runBetaAccessCommand(
  tx: Transaction,
  input: BetaAccessCommandInput,
  eventSink: DatabaseEventSink | undefined,
): Promise<BetaAccessCommandOutcome> {
  // One command id is one command, whatever its target: a concurrent reuse
  // waits here and then meets the receipt as a conflict, not a key error.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.commandId}, 59079))`,
  );
  const fact = await lockTarget(tx, input.targetUserId);
  const replayed = await storedResult(tx, input);
  if (replayed) return { kind: 'replayed', result: replayed };
  const decision = decided(input, fact);
  const result = commandResult(input.commandId, decision);
  if (decision.kind === 'changed')
    await applyChange(tx, input, decision, eventSink);
  await tx.execute(sql`insert into operator_command_receipts
      (command_id, service_id, operator_ref, action, target_user_id,
       request_digest, result, admin_audit_head)
    values (${input.commandId}, ${input.serviceId}, ${input.operatorRef},
      'account.beta_access.update', ${input.targetUserId},
      ${input.requestDigest}, ${JSON.stringify(result)}::text::jsonb, ${input.adminAuditHead})`);
  return { kind: 'applied', result };
}
