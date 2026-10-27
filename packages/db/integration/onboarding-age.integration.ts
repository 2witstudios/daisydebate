import { drizzle } from 'drizzle-orm/bun-sql';
import { admitsOptionalAnswers } from '@daisy/auth/account-age';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import { member, now, save, url, withDatabase } from './onboarding-support';
import { onboardingPrivacyAdopter } from '../src/onboarding-privacy';

setupRitewayBun();

describe('optional onboarding answers and age (ISSUE-645)', () => {
  test('optional answers need a canonical age of 16 or over (ISSUE-645)', async () => {
    await withFixture(url, async (fixture) => {
      const attempt = (birthMonth: string | null) =>
        member(fixture, birthMonth, (ids) =>
          withDatabase(async (database) => {
            const refusal = await save(database, ids, {
              step: 'about',
              wants: ['watch'],
              club: 'own',
            }).then(
              () => null,
              (error: { code?: string }) => error.code,
            );
            return [
              refusal,
              await fixture.count('member_onboarding', 'user_id', ids.userId),
              await fixture.count('member_interests', 'user_id', ids.userId),
            ];
          }),
        );
      assert({
        given:
          'a member who turned 16 this month, one a month short of 16, one under 13 and one with no age source',
        should:
          'store the 16-year-old’s answers and refuse every other with nothing stored',
        actual: [
          await attempt('2010-10'),
          await attempt('2010-11'),
          await attempt('2015-01'),
          await attempt(null),
        ],
        expected: [
          [null, 1, 1],
          ['AUTHORIZATION', 0, 0],
          ['AUTHORIZATION', 0, 0],
          ['AUTHORIZATION', 0, 0],
        ],
      });
    });
  });

  test('another member’s actor or an expired fact refuses', async () => {
    await withFixture(url, async (fixture) => {
      const other = await fixture.actor();
      const result = await member(fixture, '2000-01', (ids) =>
        withDatabase(async (database) => {
          const refused = (
            input: Parameters<typeof database.saveOnboardingStep>[0],
          ) =>
            database.saveOnboardingStep(input).then(
              () => null,
              (error: { code?: string }) => error.code,
            );
          const answers = { step: 'topics', topics: ['law'] } as const;
          return [
            await refused({
              userId: ids.userId,
              actorId: other,
              answers,
              now,
              admits: admitsOptionalAnswers,
            }),
            await refused({
              ...ids,
              answers,
              now,
              admits: (fact, actorId) =>
                admitsOptionalAnswers(
                  fact,
                  actorId,
                  '2026-11-01T00:00:00.000Z',
                ),
            }),
            await fixture.count('member_topics', 'user_id', ids.userId),
          ];
        }),
      );
      assert({
        given:
          'an adult’s session naming someone else’s actor, then the adult’s fact judged after it expires',
        should: 'refuse both and store nothing',
        actual: result,
        expected: ['AUTHORIZATION', 'AUTHORIZATION', 0],
      });
    });
  });

  test('the eligibility read follows the same fact', async () => {
    await withFixture(url, async (fixture) => {
      const read = (birthMonth: string | null) =>
        member(fixture, birthMonth, (ids) =>
          withDatabase((database) =>
            database.optionalAnswersAdmitted({
              ...ids,
              now,
              admits: admitsOptionalAnswers,
            }),
          ),
        );
      assert({
        given: 'an adult, a 15-year-old and a member with no age source',
        should: 'admit only the adult',
        actual: [
          await read('2000-01'),
          await read('2011-01'),
          await read(null),
        ],
        expected: [true, false, false],
      });
    });
  });

  test('export and erasure cover the subject’s answers only (DEC-106)', async () => {
    await withFixture(url, async (fixture) => {
      const tx = drizzle({ client: fixture.sql });
      let subjectId = '';
      const result = await member(fixture, '2000-01', (subject) =>
        member(fixture, '2000-01', async (other) => {
          await withDatabase(async (database) => {
            for (const ids of [subject, other]) {
              await save(database, ids, {
                step: 'about',
                wants: ['watch'],
                club: 'own',
              });
              await save(database, ids, { step: 'topics', topics: ['law'] });
            }
          });
          subjectId = subject.userId;
          const exported = await onboardingPrivacyAdopter.export(tx, subject);
          await onboardingPrivacyAdopter.erase(tx, subject, { now });
          return [
            exported.member_interests,
            exported.member_topics,
            exported.member_onboarding?.map((row) => [row.user_id, row.club]),
            await fixture.count('member_interests', 'user_id', subject.userId),
            await fixture.count('member_topics', 'user_id', subject.userId),
            await fixture.count('member_onboarding', 'user_id', subject.userId),
            await fixture.count('member_onboarding', 'user_id', other.userId),
          ];
        }),
      );
      assert({
        given:
          'two adult members with answers, then the first one’s export and erasure',
        should:
          'export only the first member’s rows, delete all of them, and leave the other member untouched',
        actual: result,
        expected: [
          [{ user_id: subjectId, interest: 'watch' }],
          [{ user_id: subjectId, topic: 'law' }],
          [[subjectId, 'own']],
          0,
          0,
          0,
          1,
        ],
      });
    });
  });
});
