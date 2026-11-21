import { normalizeEmail } from '@daisy/protocol/email';
import { loadAuthorizationAccount } from './authorization';
import {
  decidePreapprovalChange,
  canInviteClaimedPreapproval,
} from './beta-preapproval-decision';
import { normalizedEmailSql } from './email-identity';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import {
  preapprovalAction,
  preapprovalEntrySchema,
  preapprovalCommandSchema,
  preapprovalResultSchema,
  type PreapprovalCommand,
} from '@daisy/protocol/beta-preapproval';
import {
  claimBetaPreapproval,
  lockPreapprovalEmail,
  cancelPreapprovalInvitations,
} from './beta-preapproval-claim';
import { operatorLimits } from '@daisy/protocol/operator';
import { inTransaction, type Tx, type TxSource } from './tx';
import { takeLock, transactionLocks } from './locks';
import { run, query } from './raw-rows';
import { z } from 'zod';

/** Delivery is unknown while a send may have happened without settlement. */
const invitationStatusSql = sql.raw(
  `case when m.last_error_code = 'delivery-unknown' then 'unknown' when m.last_error_code = 'suppressed' then 'suppressed' when m.state = 'leased' or (m.state = 'queued' and m.attempts > 0) then 'unknown' else coalesce(m.state, 'none') end`,
);

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
    runPreapprovalCommand: async (input: {
      readonly command: PreapprovalCommand;
      readonly serviceId: string;
      readonly operatorRef: string;
      readonly requestDigest: string;
      readonly nextId: () => string;
      readonly live: () => boolean;
    }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!input.live()) throw createAppError('CONFLICT');
        const result = await inTransaction(database, async (tx) => {
          const command = preapprovalCommandSchema.parse(input.command);
          await run(
            tx,
            sql.raw(
              `set local statement_timeout = ${operatorLimits.commandBoundMs}`,
            ),
          );
          await takeLock(
            tx,
            transactionLocks.operatorCommand(command.commandId),
          );
          const [receipt] = await query(
            tx,
            z.object({ request_digest: z.string(), result: z.json() }),
            sql`select request_digest, result from operator_command_receipts where command_id = ${command.commandId}`,
          );
          if (receipt) {
            if (receipt.request_digest !== input.requestDigest)
              throw createAppError('CONFLICT');
            return preapprovalResultSchema.parse(receipt.result);
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
          const email =
            command.operation === 'add' ? command.email : existing?.email;
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
              fresh.some(
                (user) => !accounts.some((locked) => locked.id === user.id),
              )
            )
              return null;
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
                sql`select id from mail_intents where preapproval_id = ${grant.id} and state in ('queued', 'leased') limit 1`,
              )
            : [];
          const decision = decidePreapprovalChange({
            command,
            grant: grant
              ? {
                  id: grant.id,
                  revision: grant.revision,
                  claimed: grant.claimed_user_id !== null,
                  invited: grant.last_invited_at !== null,
                }
              : null,
            claimedAccountInvitable:
              account !== null &&
              canInviteClaimedPreapproval({
                verified: identity?.email_verified ?? false,
                emailMatches:
                  identity?.email !== null &&
                  identity?.email !== undefined &&
                  normalizeEmail(identity.email) === email,
                erased: account.erased,
                restricted: account.restricted,
                state: account.beta?.state ?? null,
                ageBand: account.ageBand,
              }),
            activeInvitation: owed !== undefined,
          });
          if (decision.kind === 'refused') throw createAppError(decision.code);
          if (decision.kind === 'remove') {
            await cancelPreapprovalInvitations(
              tx,
              decision.result.preapprovalId,
            );
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
          const result = decision.result;
          await run(
            tx,
            sql`insert into operator_command_receipts (command_id, service_id, operator_ref, action, request_digest, result, admin_audit_head) values (${command.commandId}, ${input.serviceId}, ${input.operatorRef}, ${preapprovalAction}, ${input.requestDigest}, ${JSON.stringify(result)}::text::jsonb, ${command.adminAuditHead})`,
          );
          if (!input.live()) throw createAppError('CONFLICT');
          return result;
        });
        if (result !== null) return result;
      }
      throw createAppError('CONFLICT');
    },
  };
}
