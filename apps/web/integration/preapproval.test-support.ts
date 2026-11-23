import { hostWaits } from '@daisy/worker/host';
import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol/topics';
import { createDatabase } from '@daisy/db';
import { withSql, testDatabaseUrl } from './fixtures';

type Db = ReturnType<typeof createDatabase>;
type Sql = Parameters<Parameters<typeof withSql>[0]>[0];

/** Actual store/claim/settle operations; cleanup names only this fixture's records. */
export async function withBeta(
  work: (input: {
    sql: Sql;
    db: Db;
    account: () => Promise<{ userId: string; actorId: string; email: string }>;
  }) => Promise<void>,
) {
  await withSql(async (sql) => {
    const database = createDatabase({
      waits: hostWaits,
      url: testDatabaseUrl,
      nextActorId: createId,
    });
    const users: string[] = [],
      actors: string[] = [],
      commands: string[] = [],
      grants: string[] = [];
    const db: Db = {
      ...database,
      betaAccessCommand: async (input, work) => {
        commands.push(input.commandId);
        return database.betaAccessCommand(input, work);
      },
      preapprovalCommand: async (input, work) => {
        commands.push(input.command.commandId);
        const result = await database.preapprovalCommand(input, work);
        if (result.kind === 'settled') grants.push(result.result.preapprovalId);
        return result;
      },
    };
    const account = async () => {
      const userId = createId(),
        actorId = createId();
      users.push(userId);
      actors.push(actorId);
      const email = `${userId}@operator.invalid`;
      await sql`insert into users(id,username,email,email_verified) values(${userId},${userId},${email},true)`;
      await sql`insert into actors(id,kind,user_id) values(${actorId},'human',${userId})`;
      await sql`insert into account_beta_access(user_id,state,requested_at,provenance) values(${userId},'pending',now(),'signup')`;
      await sql`insert into account_age(user_id,birth_month,version,recorded_at) values(${userId},'2000-01',1,now())`;
      return { userId, actorId, email };
    };
    try {
      await work({ sql, db, account });
    } finally {
      await database.close();
      for (const id of commands) {
        await sql`delete from mail_intents where dedupe_key=${`beta-invitation:${id}`}`;
        await sql`delete from mail_intents where dedupe_key=${`beta-approved:${id}`}`;
        await sql`delete from operator_command_receipts where command_id=${id}`;
      }
      for (const id of grants)
        await sql`delete from beta_preapprovals where id=${id}`;
      for (const id of users)
        await sql`delete from account_entitlement_grants where user_id=${id}`;
      for (const id of actors) {
        await sql`delete from outbox where topic=${buildUserInboxTopic(id)}`;
        await sql`delete from actors where id=${id}`;
      }
      for (const id of users) await sql`delete from users where id=${id}`;
    }
  });
}
