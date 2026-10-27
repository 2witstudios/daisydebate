import { emailDeliveryStatusRank } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import { createDatabase } from '../src';

const { databaseUrl: url } = requireTestServices(process.env);
setupRitewayBun();
const before = '2000-01-02T00:00:00.000Z';
const old = '2000-01-01T00:00:00.000Z';
const options = {
  before,
  limit: 50,
  signInPurpose: 'sign-in',
  recipientHashOf: (email: string) => `hash:${email}`,
};

test('retention deletes only old unclaimed unanswered accounts and their owned mail/session state', async () => {
  await withFixture(url, async (f) => {
    const database = createDatabase({ url, nextActorId: createId });
    const ids = Array.from({ length: 6 }, createId);
    const [expired, recent, member, aged, termed, actor] = ids as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const tag = createId();
    for (const id of ids)
      await f.insert('users', {
        id,
        email: `${id}@example.test`,
        created_at: id === recent ? before : old,
        username: id === member ? `member-${id}` : null,
      });
    await f.sql`insert into account_age(user_id,birth_month,recorded_at) values(${aged},'1980-01',${old})`;
    await f.sql`insert into account_terms(user_id,terms_version,accepted_at) values(${termed},'proof',${old})`;
    await f.actor(actor);
    await f.sql`insert into session(id,token,user_id,expires_at) values(${createId()},${createId()},${expired},'2099-01-01')`;
    await f.sql`insert into account(id,account_id,provider_id,user_id) values(${createId()},${createId()},'proof',${expired})`;
    const rows = [
      ['sign-in', { email: `${expired}@example.test`.toUpperCase() }],
      [
        'email-change-approve',
        {
          userId: expired,
          email: 'old@example.test',
          newEmail: 'new@example.test',
        },
      ],
      [
        'email-change-verify',
        {
          userId: expired,
          email: 'old@example.test',
          newEmail: 'new@example.test',
        },
      ],
      [
        'email-change-verify',
        { userId: recent, email: `${expired}@example.test` },
      ],
      ['other', 'not JSON'],
    ] as const;
    for (let i = 0; i < rows.length; i++)
      await f.sql`insert into verification(id,identifier,value,expires_at) values(${createId()},${`${rows[i]![0]}:${tag}:${i}`},${typeof rows[i]![1] === 'string' ? rows[i]![1] : JSON.stringify(rows[i]![1])},'2099-01-01')`;
    const hash = options.recipientHashOf(`${expired}@example.test`);
    await f.sql`insert into email_delivery(id,provider_message_id,recipient_hash,status,status_rank) values(${createId()},${tag},${hash},'sent',${emailDeliveryStatusRank('sent')})`;
    await f.sql`insert into email_suppression(recipient_hash,reason,provider_message_id) values(${hash},'bounce',${tag})`;
    try {
      const deleted = await database.purgeExpiredProvisionalUsers(options);
      const repeat = await database.purgeExpiredProvisionalUsers(options);
      const remaining = await Promise.all(
        ids.map((id) => f.count('users', 'id', id)),
      );
      const verification =
        await f.sql`select identifier from verification where identifier like ${`%:${tag}:%`} order by identifier`;
      assert({
        given:
          'expired, boundary-fresh, member, age, Terms and actor accounts with owned/unrelated mail',
        should:
          'delete exactly the expired provisional, cascade credentials, scrub owned links/receipts, preserve suppressions and be idempotent',
        actual: [
          deleted,
          repeat,
          remaining,
          await f.count('session', 'user_id', expired),
          await f.count('account', 'user_id', expired),
          verification.map((row) => row.identifier),
          await f.count('email_delivery', 'recipient_hash', hash),
          await f.count('email_suppression', 'recipient_hash', hash),
        ],
        expected: [
          1,
          0,
          [0, 1, 1, 1, 1, 1],
          0,
          0,
          [`email-change-verify:${tag}:3`, `other:${tag}:4`],
          0,
          1,
        ],
      });
    } finally {
      await database.close();
      await f.sql`delete from verification where identifier like ${`%:${tag}:%`}`;
      await f.sql`delete from email_delivery where provider_message_id=${tag}`;
      await f.sql`delete from email_suppression where recipient_hash=${hash}`;
      await f.sql`delete from account_age where user_id=${aged}`;
      await f.sql`delete from account_terms where user_id=${termed}`;
    }
  });
});

test('busy provisional rows skip the batch and a cleanup failure rolls back every delete', async () => {
  await withFixture(url, async (f) => {
    const database = createDatabase({ url, nextActorId: createId });
    const id = createId(),
      tag = createId(),
      email = `${id}@example.test`;
    await f.insert('users', { id, email, created_at: old });
    await f.sql`insert into verification(id,identifier,value,expires_at) values(${createId()},${`sign-in:${tag}`},${JSON.stringify({ email })},'2099-01-01')`;
    try {
      const skipped = await f.sql.begin(async (tx) => {
        await tx`select id from users where id=${id} for update`;
        return database.purgeExpiredProvisionalUsers(options);
      });
      let failed = false;
      try {
        await database.purgeExpiredProvisionalUsers({
          ...options,
          recipientHashOf: () => {
            throw new Error('proof cleanup failure');
          },
        });
      } catch (error) {
        failed = (error as Error).message === 'proof cleanup failure';
      }
      const kept = [
        await f.count('users', 'id', id),
        await f.count('verification', 'identifier', `sign-in:${tag}`),
      ];
      const deleted = await database.purgeExpiredProvisionalUsers(options);
      assert({
        given:
          'a locked candidate followed by a failure after verification cleanup',
        should:
          'skip without waiting, roll back mail/account removal together, then succeed on retry',
        actual: [skipped, failed, kept, deleted],
        expected: [0, true, [1, 1], 1],
      });
    } finally {
      await database.close();
      await f.sql`delete from verification where identifier=${`sign-in:${tag}`}`;
    }
  });
});

test('retention drains the oldest eligible account in each bounded batch', async () => {
  await withFixture(url, async (f) => {
    const database = createDatabase({ url, nextActorId: createId });
    const first = createId(),
      second = createId();
    await f.insert('users', { id: first, created_at: old });
    await f.insert('users', {
      id: second,
      created_at: '2000-01-01T01:00:00.000Z',
    });
    try {
      const counts = [
        await database.purgeExpiredProvisionalUsers({ ...options, limit: 1 }),
      ];
      const middle = [
        await f.count('users', 'id', first),
        await f.count('users', 'id', second),
      ];
      counts.push(
        await database.purgeExpiredProvisionalUsers({ ...options, limit: 1 }),
      );
      counts.push(
        await database.purgeExpiredProvisionalUsers({ ...options, limit: 1 }),
      );
      assert({
        given: 'two expired provisionals and a one-row batch',
        should:
          'delete oldest first, keep the second for the next batch and drain idempotently',
        actual: [counts, middle],
        expected: [
          [1, 1, 0],
          [0, 1],
        ],
      });
    } finally {
      await database.close();
    }
  });
});

test('age refusal uses the same owner-scoped email-change cleanup', async () => {
  await withFixture(url, async (f) => {
    const database = createDatabase({ url, nextActorId: createId });
    const id = createId(),
      other = createId(),
      tag = createId();
    await f.insert('users', { id, email: `${id}@example.test` });
    for (const [index, userId] of [id, other].entries())
      await f.sql`insert into verification(id,identifier,value,expires_at) values(${createId()},${`email-change-approve:${tag}:${index}`},${JSON.stringify({ userId, email: `${id}@example.test`, newEmail: 'new@example.test' })},'2099-01-01')`;
    try {
      const result = await database.deleteProvisionalUser({
        userId: id,
        ...options,
      });
      const rows =
        await f.sql`select identifier from verification where identifier like ${`%:${tag}:%`}`;
      assert({
        given:
          'an under-age provisional with its own and another user email-change subjects',
        should:
          'delete its account and its subject while retaining the other owner even with the same email',
        actual: [result, rows.map((row) => row.identifier)],
        expected: ['deleted', [`email-change-approve:${tag}:1`]],
      });
    } finally {
      await database.close();
      await f.sql`delete from verification where identifier like ${`%:${tag}:%`}`;
    }
  });
});
