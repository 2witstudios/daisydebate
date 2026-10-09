import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { accountAgePrivacyAdopter } from '../src/account-age';
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
