import { getTableColumns, getTableName } from 'drizzle-orm';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { onboardingPrivacyAdopter } from '../src/onboarding-privacy';
import { erasePrivacySubject } from '../src/privacy';
import {
  memberInterests,
  memberOnboarding,
  memberTopics,
} from '../src/schema/onboarding';
import { bindings, now, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);

const tables = [memberInterests, memberTopics, memberOnboarding];
const requiredAdopters = [
  {
    id: onboardingPrivacyAdopter.id,
    phase: onboardingPrivacyAdopter.phase,
    expectedColumns: Object.fromEntries(
      tables.map((table) => [
        getTableName(table),
        Object.values(getTableColumns(table)).map((column) => column.name),
      ]),
    ),
  },
];

test('an erasure through the privacy flow leaves no onboarding answer of its subject (ISSUE-323)', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, otherId }) => {
      for (const id of [userId, otherId]) {
        await client.unsafe(
          'insert into member_interests(user_id,interest) values($1,$2)',
          [id, 'debate'],
        );
        await client.unsafe(
          'insert into member_topics(user_id,topic) values($1,$2)',
          [id, 'law'],
        );
        await client.unsafe(
          'insert into member_onboarding(user_id,club,completed_at) values($1,$2,$3)',
          [id, 'own', now],
        );
      }
      const count = async (id: string) =>
        Promise.all(
          ['member_interests', 'member_topics', 'member_onboarding'].map(
            async (table) =>
              (
                (await client.unsafe(
                  `select count(*)::int as n from ${table} where user_id=$1`,
                  [id],
                )) as { n: number }[]
              )[0]!.n,
          ),
        );
      try {
        await erasePrivacySubject(
          database,
          { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
          { requiredAdopters, adopters: [onboardingPrivacyAdopter] },
          bindings,
        );
        assert({
          given:
            'two members with interests, topics and onboarding answers, and an erasure of one through erasePrivacySubject',
          should:
            'delete every onboarding row of the erased subject (its users row is tombstoned, so no cascade fires) and keep the other member’s',
          actual: [await count(userId), await count(otherId)],
          expected: [
            [0, 0, 0],
            [1, 1, 1],
          ],
        });
      } finally {
        for (const table of [
          'member_interests',
          'member_topics',
          'member_onboarding',
        ])
          await client.unsafe(`delete from ${table} where user_id in ($1,$2)`, [
            userId,
            otherId,
          ]);
      }
    },
  );
});
