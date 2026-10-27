import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { accountAgePrivacyAdopter } from '../src/account-age';
import { accountTermsPrivacyAdopter } from '../src/age-step';
import { erasePrivacySubject, exportPrivacySubject } from '../src/privacy';
import { bindings, now, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);
const requiredAdopters = [
  {
    id: 'account-age',
    phase: 'after-scrub' as const,
    expectedColumns: {
      account_age: ['user_id', 'birth_month', 'version', 'recorded_at'],
    },
  },
];

test('canonical account age adopter exports and erases only this subject in the caller transaction', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, otherId }) => {
      await client.unsafe(
        'insert into account_age(user_id,birth_month,recorded_at) values($1,$2,$3),($4,$5,$3)',
        [userId, '2000-01', now, otherId, '2001-02'],
      );
      const subject = { userId, actorId };
      try {
        await assertRejects({
          given: 'configured durable age producer with no cleanup adopter',
          should: 'refuse partial erasure',
          actual: () =>
            erasePrivacySubject(
              database,
              { subject, now, vendors: [], jobIds: [] },
              { requiredAdopters, adopters: [] },
              bindings,
            ),
          code: 'VALIDATION',
        });
        const adopted = {
          requiredAdopters,
          adopters: [accountAgePrivacyAdopter],
        };
        const exported = await exportPrivacySubject(database, subject, adopted);
        await erasePrivacySubject(
          database,
          { subject, now, vendors: [], jobIds: [] },
          adopted,
          bindings,
        );
        const remaining = await client.unsafe(
          'select user_id,birth_month from account_age where user_id in ($1,$2)',
          [userId, otherId],
        );
        assert({
          given:
            'two age subjects and a configured canonical after-scrub adopter',
          should:
            'export only requesting birthmonth and delete only that source',
          actual: [exported.account_age, [...remaining]],
          expected: [
            [
              {
                user_id: userId,
                birth_month: '2000-01',
                version: 1,
                recorded_at: now,
              },
            ],
            [{ user_id: otherId, birth_month: '2001-02' }],
          ],
        });
      } finally {
        await client.unsafe(
          'delete from account_age where user_id in ($1,$2)',
          [userId, otherId],
        );
      }
    },
  );
});

test('account erasure removes the age step’s birth month and Terms acceptance', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, otherId }) => {
      for (const id of [userId, otherId]) {
        await client.unsafe(
          'insert into account_age(user_id,birth_month,recorded_at) values($1,$2,$3)',
          [id, '1990-01', now],
        );
        await client.unsafe(
          'insert into account_terms(user_id,terms_version,accepted_at) values($1,$2,$3)',
          [id, 'draft-0', now],
        );
      }
      const subject = { userId, actorId };
      const adopters = [accountAgePrivacyAdopter, accountTermsPrivacyAdopter];
      try {
        await erasePrivacySubject(
          database,
          { subject, now, vendors: [], jobIds: [] },
          {
            requiredAdopters: [
              ...requiredAdopters,
              {
                id: 'account-terms',
                phase: 'after-scrub' as const,
                expectedColumns: {
                  account_terms: ['user_id', 'terms_version', 'accepted_at'],
                },
              },
            ],
            adopters,
          },
          bindings,
        );
        const remaining = async (table: string) =>
          (
            await client.unsafe(
              `select user_id from ${table} where user_id in ($1,$2) order by user_id`,
              [userId, otherId],
            )
          ).map((row: { user_id: string }) => row.user_id);
        assert({
          given:
            'two accounts that answered the age step, then erasure of the first',
          should:
            'delete the first account’s birth month and Terms acceptance and keep the other’s',
          actual: [
            await remaining('account_age'),
            await remaining('account_terms'),
          ],
          expected: [[otherId], [otherId]],
        });
      } finally {
        await client.unsafe(
          'delete from account_terms where user_id in ($1,$2)',
          [userId, otherId],
        );
        await client.unsafe(
          'delete from account_age where user_id in ($1,$2)',
          [userId, otherId],
        );
      }
    },
  );
});

test('deleting a user row takes its age-step rows with it', async () => {
  await withPrivacySubject(async ({ client }) => {
    const id = createId();
    await client.unsafe('insert into users(id) values($1)', [id]);
    await client.unsafe(
      'insert into account_age(user_id,birth_month,recorded_at) values($1,$2,$3)',
      [id, '1990-01', now],
    );
    await client.unsafe(
      'insert into account_terms(user_id,terms_version,accepted_at) values($1,$2,$3)',
      [id, 'draft-0', now],
    );
    await client.unsafe('delete from users where id=$1', [id]);
    const [left] = await client.unsafe(
      `select (select count(*)::int from account_age where user_id=$1) as age,
              (select count(*)::int from account_terms where user_id=$1) as terms`,
      [id],
    );
    assert({
      given:
        'a provisional or dev-seed user with a birth month and Terms acceptance',
      should: 'delete both when the user row is deleted, never refuse it',
      actual: left,
      expected: { age: 0, terms: 0 },
    });
  });
});
