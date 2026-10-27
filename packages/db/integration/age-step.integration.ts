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
});
