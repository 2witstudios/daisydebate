import { actorKinds } from './schema/actors';
import { listedWord } from './lifecycle-sql';
import { normalizedEmailSql } from './email-identity';
import { createAppError } from '@daisy/errors';
import {
  betaAccessCommandAction,
  betaAccessCommandResultSchema,
  type BetaAccessCommandResult,
  type BetaAccessCommandState,
  type BetaAccessDecision,
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

/** Invocation identity and final commit budget, bound to one fenced session. */
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
};

export type BetaAccessCommandOutcome =
  | { readonly kind: 'applied'; readonly result: BetaAccessCommandResult }
  | { readonly kind: 'replayed'; readonly result: BetaAccessCommandResult };

type Decision = BetaAccessDecision;
type Applied = Exclude<Decision, { kind: 'refused' }>;

/** The target's account fact, locked under the account fence; null without a human actor. */
async function lockTarget(tx: Tx, userId: string) {
  const [actor] = await query(
    tx,
    z.object({ id: z.string() }),
    sql`select id from actors where user_id = ${userId} and kind = ${listedWord(actorKinds, 'human')}`,
  );
  if (!actor) return null;
  const [fact] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  return fact ?? null;
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

type BetaAccessLoad =
  | { readonly kind: 'replayed'; readonly result: BetaAccessCommandResult }
  | {
      readonly kind: 'fresh';
      readonly account: AccountFact | null;
      readonly apply: (decision: Applied) => Promise<void>;
    };
export type BetaAccessCommandWork = (session: {
  readonly load: () => Promise<BetaAccessLoad>;
}) => Promise<void>;
type Lifecycle =
  | { readonly kind: 'new' | 'loading' | 'fresh' | 'applying' | 'closed' }
  | { readonly kind: 'settled'; readonly outcome: BetaAccessCommandOutcome };

/** Command fence, account fence, then replay; fresh decisions belong to the caller. */
export async function betaAccessCommand(
  tx: Tx,
  input: BetaAccessCommandInput,
  work: BetaAccessCommandWork,
  eventSink: DatabaseEventSink | undefined,
): Promise<BetaAccessCommandOutcome> {
  const lifecycle: { current: Lifecycle } = { current: { kind: 'new' } };
  // The callback may finish while a capability is awaiting database work.
  const phase = () => lifecycle.current.kind;
  const load = async (): Promise<BetaAccessLoad> => {
    if (phase() !== 'new') throw createAppError('INVARIANT');
    lifecycle.current = { kind: 'loading' };
    await commandGate(tx, input.commandId);
    const account = await lockTarget(tx, input.targetUserId);
    const replayed = await storedResult(
      tx,
      input.commandId,
      input.requestDigest,
    );
    if (phase() !== 'loading') throw createAppError('INVARIANT');
    if (replayed) {
      const result = betaAccessCommandResultSchema.parse(replayed);
      lifecycle.current = {
        kind: 'settled',
        outcome: { kind: 'replayed', result },
      };
      return { kind: 'replayed', result };
    }
    lifecycle.current = { kind: 'fresh' };
    return {
      kind: 'fresh',
      account,
      apply: async (decision) => {
        if (phase() !== 'fresh') throw createAppError('INVARIANT');
        lifecycle.current = { kind: 'applying' };
        const result = betaAccessCommandResultSchema.parse(
          commandResult(input.commandId, decision),
        );
        if (decision.kind === 'changed')
          await applyChange(tx, input, decision, eventSink);
        await writeReceipt(tx, input, input.targetUserId, {
          action: betaAccessCommandAction,
          result,
        });
        if (phase() !== 'applying') throw createAppError('INVARIANT');
        // Replay bypasses this check; every fresh command, including no-op, must still be live.
        if (!input.live()) throw createAppError('CONFLICT');
        lifecycle.current = {
          kind: 'settled',
          outcome: { kind: 'applied', result },
        };
      },
    };
  };
  try {
    await work({ load });
    if (lifecycle.current.kind !== 'settled') throw createAppError('INVARIANT');
    return lifecycle.current.outcome;
  } finally {
    lifecycle.current = { kind: 'closed' };
  }
}
