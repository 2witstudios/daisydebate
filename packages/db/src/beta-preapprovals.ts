import { mailJobStates } from './schema/columns';
import { listedWord, listedWords } from './lifecycle-sql';
import { mailIntentErrorCodes } from './schema/mail-intents';
import { normalizeEmail } from '@daisy/protocol/email';
import { loadAuthorizationAccount } from './authorization';
import { normalizedEmailSql } from './email-identity';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import {
  preapprovalAction,
  preapprovalEntrySchema,
  preapprovalCommandSchema,
  preapprovalResultSchema,
  type PreapprovalCommand,
  type PreapprovalDecision,
  type PreapprovalResult,
  type decidePreapprovalChange,
} from '@daisy/protocol/beta-preapproval';
import {
  claimBetaPreapproval,
  lockPreapprovalEmail,
  cancelPreapprovalInvitations,
} from './beta-preapproval-claim';
import { inTransaction, type Tx, type TxSource } from './tx';
import { commandGate, storedResult, writeReceipt } from './operator-command';
import { run, query } from './raw-rows';
import { z } from 'zod';
import { withLaneOperation } from './instrumented';

/** Delivery is unknown while a send may have happened without settlement. */
const invitationStatusSql = sql`case when m.last_error_code = ${listedWord(mailIntentErrorCodes, 'delivery-unknown')} then 'unknown' when m.last_error_code = ${listedWord(mailIntentErrorCodes, 'suppressed')} then 'suppressed' when m.state = ${listedWord(mailJobStates, 'leased')} or (m.state = ${listedWord(mailJobStates, 'queued')} and m.attempts > 0) then 'unknown' else coalesce(m.state, 'none') end`;

export async function readPreapprovalCommandState(
  database: Tx,
  commandId: string,
  result: unknown,
) {
  const [mail] = await query(
    database,
    z.object({ state: z.string() }),
    sql`select ${invitationStatusSql} as state from mail_intents m where dedupe_key = ${`beta-invitation:${commandId}`}`,
  );
  const stored = preapprovalResultSchema.parse(result);
  return {
    result: stored,
    mailState: mail?.state ?? (stored.mail === 'queued' ? 'unknown' : 'none'),
  };
}

export function preapprovalOperations({
  database,
}: {
  readonly database: TxSource;
}) {
  return {
    listBetaPreapprovals: async (input: {
      readonly limit: number;
      readonly cursor?: string;
    }) => {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 101
      )
        throw createAppError('VALIDATION');
      const rows = await query(
        database,
        preapprovalEntrySchema,
        sql`select p.id, p.email, p.revision,
        to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        case when p.claimed_user_id is null then 'unused' else 'claimed' end as status,
        case when m.state is null and p.last_invited_at is not null then 'unknown' else ${invitationStatusSql} end as invitation
        from beta_preapprovals p left join lateral (select state, attempts, last_error_code from mail_intents where preapproval_id = p.id order by created_at desc, id desc limit 1) m on true
        where ${input.cursor ? sql`p.id < ${input.cursor}` : sql`true`}
        order by p.id desc limit ${input.limit}`,
      );
      return rows;
    },
    /** One fenced attempt; the application owns early liveness and bounded restart. */
    preapprovalCommand: (
      input: PreapprovalCommandInput,
      work: PreapprovalCommandWork,
    ): Promise<PreapprovalAttempt> =>
      withLaneOperation('runPreapprovalCommand', () =>
        inTransaction(database, (tx) => runPreapprovalAttempt(tx, input, work)),
      ),
  };
}

type PreapprovalCommandInput = {
  readonly command: PreapprovalCommand;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly requestDigest: string;
  readonly nextId: () => string;
  readonly live: () => boolean;
};
type PreapprovalFacts = Parameters<typeof decidePreapprovalChange>[0];
type AcceptedPreapproval = Exclude<PreapprovalDecision, { kind: 'refused' }>;
type PreapprovalLoad =
  | { readonly kind: 'replayed'; readonly result: PreapprovalResult }
  | { readonly kind: 'restart' }
  | {
      readonly kind: 'fresh';
      readonly facts: PreapprovalFacts;
      readonly apply: (
        decision: AcceptedPreapproval,
      ) => Promise<PreapprovalResult>;
    };
type PreapprovalCommandWork = (session: {
  readonly load: () => Promise<PreapprovalLoad>;
}) => Promise<void>;
type PreapprovalAttempt =
  | { readonly kind: 'restart' }
  | { readonly kind: 'settled'; readonly result: PreapprovalResult };
type PreapprovalLifecycle =
  | { readonly kind: 'new' | 'loading' | 'fresh' | 'applying' | 'closed' }
  | PreapprovalAttempt;

/** Preparing a grant/claim is provisional until this attempt applies and settles. */
async function runPreapprovalAttempt(
  tx: Tx,
  input: PreapprovalCommandInput,
  work: PreapprovalCommandWork,
): Promise<PreapprovalAttempt> {
  const lifecycle: { current: PreapprovalLifecycle } = {
    current: { kind: 'new' },
  };
  // Work may end the attempt while an awaited load or apply is still pending.
  const phase = () => lifecycle.current.kind;
  const load = async (): Promise<PreapprovalLoad> => {
    if (phase() !== 'new') throw createAppError('INVARIANT');
    lifecycle.current = { kind: 'loading' };
    const command = preapprovalCommandSchema.parse(input.command);
    await commandGate(tx, command.commandId);
    const receipt = await storedResult(
      tx,
      command.commandId,
      input.requestDigest,
    );
    if (phase() !== 'loading') throw createAppError('INVARIANT');
    if (receipt) {
      const result = preapprovalResultSchema.parse(receipt);
      lifecycle.current = { kind: 'settled', result };
      return { kind: 'replayed', result };
    }
    // Never take an account lock after the email fence. Signup, age and revoke
    // all take their account first; removal has no account effect at all.
    const accounts =
      command.operation === 'add'
        ? await query(
            tx,
            z.object({ id: z.string() }),
            sql`select id from users where ${normalizedEmailSql(sql`email`)} = ${command.email} order by id for update`,
          )
        : [];
    const [existing] =
      command.operation === 'add'
        ? []
        : await query(
            tx,
            z.object({ email: z.string() }),
            sql`select email from beta_preapprovals where id = ${command.preapprovalId}`,
          );
    const email = command.operation === 'add' ? command.email : existing?.email;
    if (!email) throw createAppError('NOT_FOUND');
    await lockPreapprovalEmail(tx, email);
    if (command.operation === 'add') {
      // A signup may have committed after discovery but before this email
      // fence. Restart account-first; never acquire an unseen account here.
      const fresh = await query(
        tx,
        z.object({ id: z.string() }),
        sql`select id from users where ${normalizedEmailSql(sql`email`)} = ${email}`,
      );
      if (
        fresh.some((user) => !accounts.some((locked) => locked.id === user.id))
      ) {
        if (phase() !== 'loading') throw createAppError('INVARIANT');
        lifecycle.current = { kind: 'restart' };
        return { kind: 'restart' };
      }
      await run(
        tx,
        sql`insert into beta_preapprovals (id, email) values (${input.nextId()}, ${email}) on conflict (email) do nothing`,
      );
      for (const user of accounts)
        await claimBetaPreapproval(tx, user.id, {
          principal: `operator:${input.serviceId}/${input.operatorRef}`,
          commandId: command.commandId,
        });
    }
    const [grant] = await query(
      tx,
      z.object({
        id: z.string(),
        revision: z.number(),
        claimed_user_id: z.string().nullable(),
        last_invited_at: z.date().nullable(),
      }),
      sql`select id, revision, claimed_user_id, last_invited_at from beta_preapprovals where email = ${email} for update`,
    );
    const account = grant?.claimed_user_id
      ? await loadAuthorizationAccount(tx, grant.claimed_user_id)
      : null;
    const [identity] = grant?.claimed_user_id
      ? await query(
          tx,
          z.object({
            email: z.string().nullable(),
            email_verified: z.boolean(),
          }),
          sql`select email, email_verified from users where id = ${grant.claimed_user_id}`,
        )
      : [];
    const [owed] = grant
      ? await query(
          tx,
          z.object({ id: z.string() }),
          sql`select id from mail_intents where preapproval_id = ${grant.id} and state in ${listedWords(mailJobStates, ['queued', 'leased'])} limit 1`,
        )
      : [];
    const facts: PreapprovalFacts = {
      command,
      grant: grant
        ? {
            id: grant.id,
            revision: grant.revision,
            claimed: grant.claimed_user_id !== null,
            invited: grant.last_invited_at !== null,
          }
        : null,
      claimedAccount:
        account !== null
          ? {
              verified: identity?.email_verified ?? false,
              emailMatches:
                identity?.email !== null &&
                identity?.email !== undefined &&
                normalizeEmail(identity.email) === email,
              erased: account.erased,
              restricted: account.restricted,
              state: account.beta?.state ?? null,
              ageBand: account.ageBand,
            }
          : null,
      activeInvitation: owed !== undefined,
    };

    if (phase() !== 'loading') throw createAppError('INVARIANT');
    lifecycle.current = { kind: 'fresh' };
    return {
      kind: 'fresh',
      facts,
      apply: async (decision) => {
        if (phase() !== 'fresh') throw createAppError('INVARIANT');
        lifecycle.current = { kind: 'applying' };
        const result = preapprovalResultSchema.parse(decision.result);
        if (
          result.commandId !== command.commandId ||
          !grant ||
          result.preapprovalId !== grant.id
        )
          throw createAppError('INVARIANT');
        if (decision.kind === 'remove') {
          await cancelPreapprovalInvitations(tx, decision.result.preapprovalId);
          await run(
            tx,
            sql`delete from beta_preapprovals where id = ${decision.result.preapprovalId}`,
          );
        } else {
          if (decision.queueInvitation) {
            await run(
              tx,
              sql`insert into mail_intents (id, purpose, preapproval_id, dedupe_key, next_attempt_at) values (${input.nextId()}, 'beta-invitation', ${decision.result.preapprovalId}, ${`beta-invitation:${command.commandId}`}, now())`,
            );
            await run(
              tx,
              sql`update beta_preapprovals set last_invited_at = now() where id = ${decision.result.preapprovalId}`,
            );
          }
          if (decision.advanceRevision)
            await run(
              tx,
              sql`update beta_preapprovals set revision = ${decision.result.revision} where id = ${decision.result.preapprovalId}`,
            );
        }
        await writeReceipt(
          tx,
          {
            commandId: command.commandId,
            serviceId: input.serviceId,
            operatorRef: input.operatorRef,
            requestDigest: input.requestDigest,
            adminAuditHead: command.adminAuditHead,
          },
          null,
          { action: preapprovalAction, result },
        );
        if (!input.live()) throw createAppError('CONFLICT');
        if (phase() !== 'applying') throw createAppError('INVARIANT');
        lifecycle.current = { kind: 'settled', result };
        return result;
      },
    };
  };
  try {
    await work({ load });
    const state = lifecycle.current;
    if (state.kind !== 'settled' && state.kind !== 'restart')
      throw createAppError('INVARIANT');
    return state;
  } finally {
    lifecycle.current = { kind: 'closed' };
  }
}
