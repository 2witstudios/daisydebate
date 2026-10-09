import { requireTestServices } from '@daisy/config';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  writeAccountBirthMonth,
  loadAccountAgeSource,
  accountAgePrivacyAdopter,
} from '../src/account-age';
import { erasePrivacySubject, exportPrivacySubject } from '../src/privacy';
import { bindings, now, withPrivacySubject } from './privacy.test-support';
setupRitewayBun();
requireTestServices(process.env);
const authority = {
  status: 'approved' as const,
  decision: 'isolated test-only authority; no collection activation',
};
const adoption = {
  requiredAdopters: [
    {
      id: 'account-age',
      phase: 'after-scrub' as const,
      expectedColumns: {
        account_age: ['user_id', 'birth_month', 'version', 'recorded_at'],
      },
    },
  ],
  adopters: [accountAgePrivacyAdopter],
};
test('age correction and erasure share the account fence and subject-local export', async () => {
  await withPrivacySubject(async ({ database, userId, actorId, otherId }) => {
    try {
      const first = await writeAccountBirthMonth(
        database,
        {
          userId,
          birthMonth: '2000-01',
          now,
          expectedAccountRevision: 1,
          expectedAgeRevision: null,
        },
        authority,
      );
      const correction = await writeAccountBirthMonth(
        database,
        {
          userId,
          birthMonth: '2015-01',
          now,
          expectedAccountRevision: 2,
          expectedAgeRevision: 1,
        },
        authority,
      );
      await assertRejects({
        given: 'a stale correction against the prior account and age versions',
        should: 'reject atomically before replacing the corrected source',
        actual: () =>
          writeAccountBirthMonth(
            database,
            {
              userId,
              birthMonth: '2000-01',
              now,
              expectedAccountRevision: 2,
              expectedAgeRevision: 1,
            },
            authority,
          ),
        code: 'CONFLICT',
      });
      const source = await loadAccountAgeSource(database, userId);
      const exported = await exportPrivacySubject(
        database,
        { userId, actorId },
        adoption,
      );
      assert({
        given: 'two versioned writes and a conflicting retry',
        should: 'retain corrected facts and export only the subject source',
        actual: [
          first,
          correction,
          source,
          exported.account_age,
          await loadAccountAgeSource(database, otherId),
        ],
        expected: [
          { revision: 1, accountRevision: 2 },
          { revision: 2, accountRevision: 3 },
          { birthMonth: '2015-01', revision: 2, recordedAt: now },
          [
            {
              user_id: userId,
              birth_month: '2015-01',
              version: 2,
              recorded_at: now,
            },
          ],
          null,
        ],
      });
      await erasePrivacySubject(
        database,
        { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
        adoption,
        bindings,
      );
      assert({
        given: 'canonical account erasure with required age adopter',
        should: 'delete private birth data in the same committed transaction',
        actual: await loadAccountAgeSource(database, userId),
        expected: null,
      });
    } finally {
      await database.execute(
        sql`delete from account_age where user_id=${userId}`,
      );
    }
  });
});
