import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { onboardingPrivacyAdopter } from '../src/onboarding-privacy';
import { runPrivacyErasure } from '../src/privacy/operations';
import { bindings, now, withPrivacySubject } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);

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
          'insert into member_leagues(user_id,league) values($1,$2)',
          [id, 'Public Forum League'],
        );
        await client.unsafe(
          'insert into member_onboarding(user_id,club,club_name,completed_at) values($1,$2,$3,$4)',
          [id, 'own', 'Debate Club', now],
        );
      }
      const count = async (id: string) =>
        Promise.all(
          [
            'member_interests',
            'member_topics',
            'member_leagues',
            'member_onboarding',
          ].map(
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
        await runPrivacyErasure(
          database,
          { subject: { userId, actorId }, now, vendors: [], jobIds: [] },
          [onboardingPrivacyAdopter],
          bindings,
        );
        assert({
          given:
            'two members with interests, topics, leagues and onboarding answers, and an erasure of one through runPrivacyErasure',
          should:
            'delete every onboarding row of the erased subject, leagues included (its users row is tombstoned, so no cascade fires) and keep the other member’s',
          actual: [await count(userId), await count(otherId)],
          expected: [
            [0, 0, 0, 0],
            [1, 1, 1, 1],
          ],
        });
      } finally {
        for (const table of [
          'member_interests',
          'member_topics',
          'member_leagues',
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

test('the onboarding export carries the free-text answers and nothing of another member', async () => {
  await withPrivacySubject(
    async ({ client, database, userId, actorId, otherId }) => {
      await client.unsafe(
        'insert into member_leagues(user_id,league) values($1,$2),($3,$4)',
        [userId, 'Axe League', otherId, 'Rival League'],
      );
      await client.unsafe(
        'insert into member_onboarding(user_id,club,club_name,experience,completed_at) values($1,$2,$3,$4,$5)',
        [userId, 'joining', 'Debate Club', 'class', now],
      );
      try {
        const exported = await onboardingPrivacyAdopter.export(database, {
          userId,
          actorId,
        });
        assert({
          given:
            'a subject with a league and named club, and another member with their own league',
          should:
            'export the subject’s leagues and club name and no other member’s rows',
          actual: [
            (exported.member_leagues ?? []).map((row) => row.league),
            (exported.member_onboarding ?? [])[0]?.club_name,
            JSON.stringify(exported).includes('Rival League'),
          ],
          expected: [['Axe League'], 'Debate Club', false],
        });
      } finally {
        await client.unsafe(
          'delete from member_leagues where user_id in ($1,$2)',
          [userId, otherId],
        );
        await client.unsafe('delete from member_onboarding where user_id=$1', [
          userId,
        ]);
      }
    },
  );
});
