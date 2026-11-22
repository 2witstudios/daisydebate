import { normalizedEmailSql } from './email-identity';
import { createAppError } from '@daisy/errors';
import {
  betaAccessCommandAction,
  betaAccessCommandResultSchema,
  type BetaAccessCommandResult,
  type BetaAccessCommandState,
  type BetaAccessDecision,
  type BetaAccessState,
} from '@daisy/protocol/beta-access';
import { sql } from 'drizzle-orm';
import { lockAuthorizationActors } from './authorization';
import type { authorizationAccountFact } from './authorization-account';
import type { DatabaseEventSink } from './instrumented';
import { appendSessionRevokedFor } from './session-revoked';
import { writeBetaAccessChange } from './beta-access-change';
import { mailIntentQueue } from './mail-intent-queue';
import type { Tx } from './tx';
import { commandGate, storedResult, writeReceipt } from './operator-command';
import { run, query } from './raw-rows';
import { z } from 'zod';

/** The approval mail a command owes, deduplicated by the command that owed it. */
const approvalMailKey = (commandId: string) => `beta-approved:${commandId}`;

/**
 * Beta access's part of an operator command readback: the stored result and
 * the state of the approval mail it owed (null when it owed none).
 */
export async function readBetaAccessCommandState(
  database: Tx,
  commandId: string,
  result: unknown,
): Promise<Omit<BetaAccessCommandState, 'action'>> {
  const [mail] = await query(
    database,
    z.object({ state: z.string() }),
    sql`select state from mail_intents
    where dedupe_key = ${approvalMailKey(commandId)}`,
  );
  return {
    result: betaAccessCommandResultSchema.parse(result),
    mailState: (mail?.state ?? null) as BetaAccessCommandState['mailState'],
  };
}
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
  /** True while the signed request may still commit (ADR 0079, checked last). */
  readonly live: () => boolean;
  readonly authorize: (target: AccountFact | null) => boolean;
  readonly decide: (
    current: {
      readonly state: BetaAccessState;
      readonly revision: number;
    } | null,
    ageBand: AccountFact['ageBand'],
  ) => BetaAccessDecision;
};

export type BetaAccessCommandOutcome =
  | { readonly kind: 'applied'; readonly result: BetaAccessCommandResult }
  | { readonly kind: 'replayed'; readonly result: BetaAccessCommandResult };

type Decision = BetaAccessDecision;
type Applied = Exclude<Decision, { kind: 'refused' }>;

const refusalCode = {
  stale: 'CONFLICT',
  'not-found': 'NOT_FOUND',
  // ISSUE-664: approval needs a durable 13+ age record first.
  'age-required': 'INVARIANT',
} as const;

/** The target's account fact, locked under the account fence; null without a human actor. */
async function lockTarget(tx: Tx, userId: string) {
  const [actor] = await query(
    tx,
    z.object({ id: z.string() }),
    sql`select id from actors where user_id = ${userId} and kind = 'human'`,
  );
  if (!actor) return null;
  const [fact] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  return fact ?? null;
}

const liveTarget = (
  fact: AccountFact | null,
  userId: string,
): fact is AccountFact =>
  fact !== null && !fact.erased && fact.userId === userId;

/** The transition the fresh fact allows; a refusal throws and writes nothing. */
function decided(
  input: BetaAccessCommandInput,
  fact: AccountFact | null,
): Applied {
  if (!liveTarget(fact, input.targetUserId)) throw createAppError('NOT_FOUND');
  if (!input.authorize(fact)) throw createAppError('AUTHORIZATION');
  const decision = input.decide(fact.beta, fact.ageBand);
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

/** State, revision, entitlement grants, audit event and the owed mail or revocation push. */
async function applyChange(
  tx: Tx,
  input: BetaAccessCommandInput,
  decision: Extract<Decision, { kind: 'changed' }>,
  eventSink: DatabaseEventSink | undefined,
) {
  await writeBetaAccessChange(tx, {
    userId: input.targetUserId,
    change: decision,
    eventId: input.nextId(),
    commandId: input.commandId,
    principal: `operator:${input.serviceId}/${input.operatorRef}`,
  });
  if (decision.to === 'approved')
    await run(
      tx,
      sql`insert into mail_intents
        (id, purpose, recipient_user_id, dedupe_key, next_attempt_at)
      values (${input.nextId()}, 'beta-approved', ${input.targetUserId},
        ${approvalMailKey(input.commandId)}, now())`,
    );
  else {
    // A revoked account's invitations, by its claim or its address, are not owed.
    await mailIntentQueue.cancelOwed(
      tx,
      sql`preapproval_id in (select id from beta_preapprovals
        where claimed_user_id = ${input.targetUserId}
          or email = (select ${normalizedEmailSql(sql`email`)} from users where id = ${input.targetUserId}))`,
    );
    await appendSessionRevokedFor(
      tx,
      input.targetUserId,
      eventSink,
      'runBetaAccessCommand',
    );
  }
}

/**
 * One beta access command inside its transaction, under the target's
 * account fence: the receipt first (the same digest replays the stored
 * result), then authority and the transition on the fresh fact, then
 * state, audit event, owed mail or revocation push and the receipt.
 */
export async function runBetaAccessCommand(
  tx: Tx,
  input: BetaAccessCommandInput,
  eventSink: DatabaseEventSink | undefined,
): Promise<BetaAccessCommandOutcome> {
  await commandGate(tx, input.commandId);
  const fact = await lockTarget(tx, input.targetUserId);
  const replayed = await storedResult(tx, input.commandId, input.requestDigest);
  if (replayed)
    return {
      kind: 'replayed',
      result: betaAccessCommandResultSchema.parse(replayed),
    };
  const decision = decided(input, fact);
  const result = commandResult(input.commandId, decision);
  if (decision.kind === 'changed')
    await applyChange(tx, input, decision, eventSink);
  await writeReceipt(tx, input, input.targetUserId, {
    action: betaAccessCommandAction,
    result,
  });
  // Checked last: a PUT delayed past its signed deadline (behind a lock, say)
  // writes nothing, so an admin that waited out the deadline may abandon it.
  if (!input.live()) throw createAppError('CONFLICT');
  return { kind: 'applied', result };
}
