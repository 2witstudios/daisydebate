import { expect, test } from 'bun:test';
import { SQL, type TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { protectionLimits } from '@daisy/protocol/protection-level';
import {
  dmRequestPolicyRows,
  protectionChoices,
} from '../scripts/protection-policy-sql';
import { requireTestServices } from '@daisy/config';
import { rejectedBy } from './constraint-helpers';

const { databaseUrl } = requireTestServices(process.env);

/** Carries what a transaction read out of the rollback that discards its rows. */
class RollbackWith extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

/** Runs `work` in a transaction that is always rolled back, returning its result. */
const rolledBack = async <T>(
  work: (tx: TransactionSQL) => Promise<T>,
): Promise<T> => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    return (await sql
      .begin(async (tx) => {
        throw new RollbackWith(await work(tx));
      })
      .catch((error: unknown) => {
        if (error instanceof RollbackWith) return error.value;
        throw error;
      })) as T;
  } finally {
    await sql.close();
  }
};

test('the DM request rule is the canonical lookup', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const [row] = (await sql`select prosrc from pg_proc
      where oid = 'public.daisy_dm_request_access(text,text)'::regprocedure`) as {
      prosrc: string;
    }[];
    expect(row?.prosrc).toContain(
      `VALUES\n    ${dmRequestPolicyRows()}\n  ), instant`,
    );
  } finally {
    await sql.close();
  }
});

test('protection functions, grants and guardian-approval notification checks hold', async () => {
  const outcome = await rolledBack(async (tx) => {
    const id = () => createId();
    const [recipientUser, guardian, linkedChild] = [id(), id(), id()];
    const [recipient, requester] = [id(), id()];
    const requestedAt = new Date();
    await tx`insert into users(id, username) values(${recipientUser}, ${`u-${recipientUser}`})`;
    for (const [person, years] of [
      [guardian, '40 years'],
      [linkedChild, '15 years'],
    ] as const) {
      await tx`insert into users(id, username) values(${person}, ${`u-${person}`})`;
      await tx`insert into account_age(user_id,birth_month,version,recorded_at)
        values(${person},to_char(now() - ${years}::interval,'YYYY-MM'),1,${requestedAt})`;
    }
    await tx`insert into actors(id, kind, user_id) values(${recipient}, 'human', ${recipientUser})`;
    const requesterUser = id();
    await tx`insert into users(id, username) values(${requesterUser}, ${`u-${requesterUser}`})`;
    await tx`insert into actors(id, kind, user_id) values(${requester}, 'human', ${requesterUser})`;
    const evidence = id();
    await tx`insert into guardian_consent_evidence(id,person_user_id,role,method,notice_kind,notice_version,notice_digest,recorded_at)
      values(${evidence},${guardian},'guardian','created-account','parental-consent','fixture',${'a'.repeat(64)},${requestedAt})`;
    const link = id();
    await tx`insert into guardian_links(id,guardian_user_id,minor_user_id,guardian_consent_id,status,activation,activated_at,created_at)
      values(${link},${guardian},${linkedChild},${evidence},'active','created-account',${requestedAt},${requestedAt})`;
    const [low, high] = [recipient, requester].sort();
    await tx`insert into contact_pairs(low_actor_id, high_actor_id) values(${low},${high})`;
    await tx`insert into friendships(low_actor_id, high_actor_id, requester_actor_id, state, requested_at)
      values(${low},${high},${requester},'pending',${requestedAt})`;
    const grants = await tx`select
      has_function_privilege('daisy_web', 'public.daisy_linked_adult_users_at(text,timestamptz)', 'EXECUTE') as web,
      has_function_privilege('daisy_realtime', 'public.daisy_linked_adult_users_at(text,timestamptz)', 'EXECUTE') as realtime`;
    const [adult] =
      await tx`select public.daisy_effective_protection_choice(${recipientUser}) as choice`;
    const [child] =
      await tx`select public.daisy_effective_protection_choice(${linkedChild}) as choice`;
    const expansions = [];
    for (const choice of protectionChoices) {
      const [limits] =
        await tx`select * from public.daisy_expand_protection(${JSON.stringify(choice)}::text::jsonb)`;
      const expanded = protectionLimits(choice);
      expansions.push([
        limits,
        {
          friend_approval: expanded.friendApproval,
          friends_only: expanded.messageRequests === 'friends',
          ranked_allowed: expanded.rankedAllowed,
        },
      ]);
    }
    const inSavepoint = (write: (sp: SQL) => Promise<unknown>) =>
      rejectedBy(() => tx.savepoint((sp) => write(sp)));
    const writes = [
      await inSavepoint(
        (
          sp,
        ) => sp`insert into notification_preferences(user_id,kind,channel,enabled)
          values(${guardian},'friend_guardian_approval','email',true)`,
      ),
      await inSavepoint(
        (
          sp,
        ) => sp`insert into notification_preferences(user_id,kind,channel,enabled)
          values(${guardian},'friend_guardian_approval','in_app',true)`,
      ),
      await inSavepoint(
        (sp) => sp`insert into notifications(id,user_id,kind,actor_id)
          values(${id()},${guardian},'friend_guardian_approval',${requester})`,
      ),
      await inSavepoint(
        (
          sp,
        ) => sp`insert into notifications(id,user_id,kind,actor_id,friendship_low_actor_id,friendship_high_actor_id)
          values(${id()},${guardian},'friend_guardian_approval',${requester},${low},${high})`,
      ),
    ];
    return {
      grants: [...grants],
      adult: adult?.choice,
      child: child?.choice,
      expansions,
      writes,
    };
  });
  expect<unknown>(outcome.grants).toEqual([{ web: false, realtime: false }]);
  expect<unknown>(outcome.adult).toEqual({ level: 'independent' });
  expect<unknown>(outcome.child).toEqual({ level: 'guided' });
  for (const [actual, expected] of outcome.expansions)
    expect<unknown>(actual).toEqual(expected);
  expect(outcome.writes).toEqual([
    'notification_preferences_pair_check',
    null,
    'notifications_subject_check',
    null,
  ]);
});
