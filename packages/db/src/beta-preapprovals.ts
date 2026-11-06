import { normalizedEmailSql } from './email-identity';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  preapprovalAction,
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

type Database = Pick<BunSQLDatabase, 'execute' | 'transaction'>;
type Tx = Pick<BunSQLDatabase, 'execute'>;

/** Delivery is unknown while a send may have happened without settlement. */
export const invitationStatusSql = sql.raw(
  `case when m.last_error_code = 'suppressed' then 'suppressed' when m.state = 'leased' or (m.state = 'queued' and m.attempts > 0) then 'unknown' else coalesce(m.state, 'none') end`,
);

export async function readPreapprovalCommandState(
  database: Tx,
  commandId: string,
  result: unknown,
) {
  const [mail] = (await database.execute(
    sql`select ${invitationStatusSql} as state from mail_intents m where dedupe_key = ${`beta-invitation:${commandId}`}`,
  )) as unknown as { state: string }[];
  return {
    result: preapprovalResultSchema.parse(result),
    mailState: mail?.state ?? 'none',
  };
}

export function preapprovalOperations({
  database,
}: {
  readonly database: Database;
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
      return database.execute(sql`select p.id, p.email, p.revision,
        to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
        case when p.claimed_by is null then 'unused' else 'claimed' end as status,
        case when m.state is null and p.last_invited_at is not null then 'unknown' else ${invitationStatusSql} end as invitation
        from beta_preapprovals p left join lateral (select state, attempts, last_error_code from mail_intents where preapproval_id = p.id order by created_at desc, id desc limit 1) m on true
        where ${input.cursor ? sql`p.id < ${input.cursor}` : sql`true`}
        order by p.id desc limit ${input.limit}`);
    },
    runPreapprovalCommand: async (input: {
      readonly command: PreapprovalCommand;
      readonly serviceId: string;
      readonly operatorRef: string;
      readonly requestDigest: string;
      readonly nextId: () => string;
      readonly live: () => boolean;
    }) =>
      database.transaction(async (tx) => {
        const command = preapprovalCommandSchema.parse(input.command);
        await tx.execute(
          sql.raw(
            `set local statement_timeout = ${operatorLimits.commandBoundMs}`,
          ),
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.commandId}, 59079))`,
        );
        const [receipt] = (await tx.execute(
          sql`select request_digest, result from operator_command_receipts where command_id = ${command.commandId}`,
        )) as unknown as { request_digest: string; result: unknown }[];
        if (receipt) {
          if (receipt.request_digest !== input.requestDigest)
            throw createAppError('CONFLICT');
          return preapprovalResultSchema.parse(receipt.result);
        }
        // Never take an account lock after the email fence. Signup, age and revoke
        // all take their account first; removal has no account effect at all.
        const accounts =
          command.operation === 'add'
            ? ((await tx.execute(
                sql`select id from users where ${normalizedEmailSql(sql`email`)} = ${command.email} order by id for update`,
              )) as unknown as { id: string }[])
            : [];
        const [existing] =
          command.operation === 'add'
            ? []
            : ((await tx.execute(
                sql`select email from beta_preapprovals where id = ${command.preapprovalId}`,
              )) as unknown as { email: string }[]);
        const email =
          command.operation === 'add' ? command.email : existing?.email;
        if (!email) throw createAppError('NOT_FOUND');
        await lockPreapprovalEmail(tx, email);
        if (command.operation === 'add') {
          await tx.execute(
            sql`insert into beta_preapprovals (id, email) values (${input.nextId()}, ${email}) on conflict (email) do nothing`,
          );
          for (const user of accounts) await claimBetaPreapproval(tx, user.id);
        }
        const [grant] = (await tx.execute(
          sql`select id, revision, claimed_by, last_invited_at from beta_preapprovals where email = ${email} for update`,
        )) as unknown as {
          id: string;
          revision: number;
          claimed_by: string | null;
          last_invited_at: Date | null;
        }[];
        if (
          !grant ||
          (command.operation !== 'add' && grant.id !== command.preapprovalId)
        )
          throw createAppError('NOT_FOUND');
        if (
          command.operation !== 'add' &&
          command.expectedRevision !== grant.revision
        )
          throw createAppError('CONFLICT');
        const invite =
          command.operation === 'invite' ||
          (command.operation === 'add' && command.invite);
        if (invite && grant.claimed_by) {
          const [account] = (await tx.execute(
            sql`select b.state, u.deleted_at from users u left join account_beta_access b on b.user_id = u.id where u.id = ${grant.claimed_by}`,
          )) as unknown as { state: string | null; deleted_at: Date | null }[];
          if (!account || account.deleted_at || account.state !== 'approved')
            throw createAppError('CONFLICT');
        }
        // One active invitation per grant. An explicit resend after terminal delivery
        // creates a new intent; duplicate submissions while queued owe no second mail.
        const [owed] = (await tx.execute(
          sql`select id from mail_intents where preapproval_id = ${grant.id} and (${command.operation === 'add'} or state in ('queued', 'leased')) limit 1`,
        )) as unknown as { id: string }[];
        const queued =
          invite &&
          !owed &&
          (command.operation !== 'add' || grant.last_invited_at === null);
        if (queued)
          await tx.execute(
            sql`insert into mail_intents (id, purpose, preapproval_id, dedupe_key, next_attempt_at) values (${input.nextId()}, 'beta-invitation', ${grant.id}, ${`beta-invitation:${command.commandId}`}, now())`,
          );
        if (queued)
          await tx.execute(
            sql`update beta_preapprovals set last_invited_at = now() where id = ${grant.id}`,
          );
        if (command.operation === 'remove') {
          await cancelPreapprovalInvitations(tx, grant.id);
          await tx.execute(
            sql`delete from beta_preapprovals where id = ${grant.id}`,
          );
        } else if (command.operation === 'invite')
          await tx.execute(
            sql`update beta_preapprovals set revision = revision + 1 where id = ${grant.id}`,
          );
        const result = preapprovalResultSchema.parse({
          commandId: command.commandId,
          preapprovalId: grant.id,
          revision: grant.revision + (command.operation === 'invite' ? 1 : 0),
          outcome: command.operation === 'remove' ? 'removed' : 'saved',
          mail: queued ? 'queued' : 'none',
        });
        await tx.execute(
          sql`insert into operator_command_receipts (command_id, service_id, operator_ref, action, request_digest, result, admin_audit_head) values (${command.commandId}, ${input.serviceId}, ${input.operatorRef}, ${preapprovalAction}, ${input.requestDigest}, ${JSON.stringify(result)}::text::jsonb, ${command.adminAuditHead})`,
        );
        if (!input.live()) throw createAppError('CONFLICT');
        return result;
      }),
  };
}
