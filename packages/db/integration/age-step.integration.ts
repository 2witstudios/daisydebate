import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  emailDeliveryStatusRank,
  emailDeliveryStatuses,
} from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import { createDatabase } from '../src';
import { accountTermsPrivacyAdopter } from '../src/age-step';

const { databaseUrl: url } = requireTestServices(process.env);
setupRitewayBun();

const now = '2026-10-26T12:00:00.000Z';
const withDatabase = async <T>(
  run: (database: ReturnType<typeof createDatabase>) => Promise<T>,
) => {
  const database = createDatabase({ url, nextActorId: createId });
  try {
    return await run(database);
  } finally {
    await database.close();
  }
};

describe('the age step (WAIT-4.6, WAIT-4.7)', () => {
  test('records the birth month and Terms together, once', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      try {
        const result = await withDatabase(async (database) => [
          await database.hasRecordedAge(userId),
          await database.recordAgeStep({
            userId,
            birthMonth: '2000-01',
            termsVersion: 'draft-0',
            now,
          }),
          await database.recordAgeStep({
            userId,
            birthMonth: '1990-05',
            termsVersion: 'draft-1',
            now,
          }),
          await database.hasRecordedAge(userId),
        ]);
        const [age] =
          await fixture.sql`select birth_month,version from account_age where user_id=${userId}`;
        const [terms] =
          await fixture.sql`select terms_version from account_terms where user_id=${userId}`;
        assert({
          given: 'an answer, then a second, different answer',
          should:
            'record the first answer’s month and Terms and keep them on the second',
          actual: [result, age, terms],
          expected: [
            [false, 'recorded', 'already-recorded', true],
            { birth_month: '2000-01', version: 1 },
            { terms_version: 'draft-0' },
          ],
        });
      } finally {
        await fixture.sql`delete from account_terms where user_id=${userId}`;
        await fixture.sql`delete from account_age where user_id=${userId}`;
      }
    });
  });

  test('export and erasure cover the subject’s Terms acceptance only', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const otherId = await fixture.user();
      const tx = drizzle({ client: fixture.sql });
      try {
        await withDatabase(async (database) => {
          for (const id of [userId, otherId])
            await database.recordAgeStep({
              userId: id,
              birthMonth: '2000-01',
              termsVersion: 'draft-0',
              now,
            });
        });
        const subject = { userId, actorId: createId() };
        const exported = await accountTermsPrivacyAdopter.export(tx, subject);
        await accountTermsPrivacyAdopter.erase(tx, subject, { now });
        assert({
          given:
            'two members’ acceptances, then the first one’s export and erasure',
          should: 'export only the first, delete it, and keep the other',
          actual: [
            exported.account_terms?.map((row) => [
              row.user_id,
              row.terms_version,
            ]),
            await fixture.count('account_terms', 'user_id', userId),
            await fixture.count('account_terms', 'user_id', otherId),
          ],
          expected: [[[userId, 'draft-0']], 0, 1],
        });
      } finally {
        await fixture.sql`delete from account_terms where user_id in (${userId},${otherId})`;
        await fixture.sql`delete from account_age where user_id in (${userId},${otherId})`;
      }
    });
  });

  test('an under-age answer deletes only a provisional account', async () => {
    await withFixture(url, async (fixture) => {
      const provisional = createId();
      await fixture.sql`insert into users(id,email) values(${provisional},${`${provisional}@example.test`})`;
      const status = emailDeliveryStatuses[0];
      await fixture.sql`insert into email_delivery(id,provider_message_id,recipient_hash,status,status_rank)
        values(${createId()},${createId()},${`hash-${provisional}`},${status},${emailDeliveryStatusRank(status)})`;
      const member = await fixture.user();
      const results = await withDatabase(async (database) => [
        await database.deleteProvisionalUser({
          userId: provisional,
          signInPurpose: 'sign-in',
          recipientHashOf: (email) => `hash-${email.split('@')[0]}`,
        }),
        await database.deleteProvisionalUser({
          userId: member,
          signInPurpose: 'sign-in',
          recipientHashOf: () => 'hash-member',
        }),
      ]);
      assert({
        given:
          'a provisional account with a delivery receipt, then a member with a username',
        should:
          'delete the provisional account and its receipts, and refuse the member, leaving it',
        actual: [
          results,
          await fixture.count('users', 'id', provisional),
          await fixture.count(
            'email_delivery',
            'recipient_hash',
            `hash-${provisional}`,
          ),
          await fixture.count('users', 'id', member),
        ],
        expected: [['deleted', 'refused'], 0, 0, 1],
      });
    });
  });

  test('deleting a provisional account takes its sign-in rows and keeps suppressions', async () => {
    await withFixture(url, async (fixture) => {
      const id = createId();
      const email = `${id}@example.test`;
      const hash = `hash-${id}`;
      await fixture.sql`insert into users(id,email) values(${id},${email})`;
      await fixture.sql`insert into session(id,token,user_id,expires_at)
        values(${createId()},${createId()},${id},${now})`;
      await fixture.sql`insert into verification(id,identifier,value,expires_at) values
        (${createId()},${`sign-in:${id}`},${JSON.stringify({ email: email.toUpperCase() })},${now}),
        (${createId()},${`other:${id}`},${JSON.stringify({ email })},${now})`;
      await fixture.sql`insert into email_suppression(recipient_hash,reason,provider_message_id)
        values(${hash},'bounce',${createId()})`;
      try {
        const result = await withDatabase((database) =>
          database.deleteProvisionalUser({
            userId: id,
            signInPurpose: 'sign-in',
            recipientHashOf: () => hash,
          }),
        );
        assert({
          given:
            'a provisional account with a session, its sign-in link (email in another case), an unrelated link and a suppression',
          should:
            'delete the account, its session and its sign-in link, and keep the unrelated link and the suppression',
          actual: [
            result,
            await fixture.count('session', 'user_id', id),
            await fixture.count('verification', 'identifier', `sign-in:${id}`),
            await fixture.count('verification', 'identifier', `other:${id}`),
            await fixture.count('email_suppression', 'recipient_hash', hash),
          ],
          expected: ['deleted', 0, 0, 1, 1],
        });
      } finally {
        await fixture.sql`delete from verification where identifier=${`other:${id}`}`;
        await fixture.sql`delete from email_suppression where recipient_hash=${hash}`;
      }
    });
  });

  test('an account that answered, or no account, is never deleted', async () => {
    await withFixture(url, async (fixture) => {
      const answered = createId();
      await fixture.sql`insert into users(id,email) values(${answered},${`${answered}@example.test`})`;
      try {
        const results = await withDatabase(async (database) => {
          await database.recordAgeStep({
            userId: answered,
            birthMonth: '1990-01',
            termsVersion: 'draft-0',
            now,
          });
          const forget = (userId: string) =>
            database.deleteProvisionalUser({
              userId,
              signInPurpose: 'sign-in',
              recipientHashOf: () => 'hash-none',
            });
          return [await forget(answered), await forget(createId())];
        });
        assert({
          given:
            'a provisional account that already recorded an adult age, then an id with no account',
          should:
            'refuse both and keep the first answer, so a later under-age answer never deletes it',
          actual: [
            results,
            await fixture.count('users', 'id', answered),
            await fixture.count('account_age', 'user_id', answered),
          ],
          expected: [['refused', 'refused'], 1, 1],
        });
      } finally {
        await fixture.sql`delete from account_terms where user_id=${answered}`;
        await fixture.sql`delete from account_age where user_id=${answered}`;
        await fixture.sql`delete from users where id=${answered}`;
      }
    });
  });
});
