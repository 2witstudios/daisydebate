import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import { member, save, url, withDatabase } from './onboarding-support';

requireTestServices(process.env);
setupRitewayBun();

describe('onboarding answers (ONB-1.4)', () => {
  test('a member with nothing stored', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      assert({
        given: 'a member who has answered nothing',
        should: 'read back empty answers',
        actual: await withDatabase((database) =>
          database.readOnboarding(userId),
        ),
        expected: {
          wants: [],
          club: null,
          experience: null,
          formats: [],
          topics: [],
          completedAt: null,
        },
      });
    });
  });

  test('each step replaces only its own answers', async () => {
    await withFixture(url, async (fixture) => {
      const answers = await member(fixture, '2000-01', (ids) =>
        withDatabase(async (database) => {
          await save(database, ids, {
            step: 'about',
            wants: ['debate', 'watch'],
            club: 'own',
          });
          await save(database, ids, {
            step: 'experience',
            experience: 'class',
            formats: ['one-on-one'],
          });
          await save(database, ids, {
            step: 'topics',
            topics: ['law', 'ethics'],
          });
          await save(database, ids, {
            step: 'about',
            wants: ['judge'],
            club: 'starting',
          });
          return database.readOnboarding(ids.userId);
        }),
      );
      assert({
        given: 'an adult member: all three steps and then the about step again',
        should: 'keep the later about answers and the other steps untouched',
        actual: answers,
        expected: {
          wants: ['judge'],
          club: 'starting',
          experience: 'class',
          formats: ['one-on-one'],
          topics: ['ethics', 'law'],
          completedAt: null,
        },
      });
    });
  });

  test('completion is recorded once', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const first = new Date('2026-10-05T12:00:00.000Z');
      const later = new Date('2026-10-06T12:00:00.000Z');
      const completedAt = await withDatabase(async (database) => {
        await database.completeOnboarding(userId, first);
        await database.completeOnboarding(userId, later);
        return (await database.readOnboarding(userId)).completedAt;
      });
      assert({
        given: 'a finish and then a second finish a day later',
        should: 'keep the first time',
        actual: completedAt,
        expected: '2026-10-05T12:00:00.000Z',
      });
    });
  });

  test('a value off the vocabulary leaves the step unchanged', async () => {
    await withFixture(url, async (fixture) => {
      const answers = await member(fixture, '2000-01', (ids) =>
        withDatabase(async (database) => {
          await save(database, ids, { step: 'topics', topics: ['law'] });
          await save(database, ids, {
            step: 'topics',
            topics: ['health', 'astrology' as never],
          }).catch(() => undefined);
          return database.readOnboarding(ids.userId);
        }),
      );
      assert({
        given: 'a topics write whose second value the CHECK refuses',
        should: 'roll the whole step back',
        actual: answers.topics,
        expected: ['law'],
      });
    });
  });

  test('deleting the user deletes the answers', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await member(fixture, '2000-01', async (ids) => {
        await withDatabase(async (database) => {
          await save(database, ids, {
            step: 'about',
            wants: ['coach'],
            club: 'joining',
          });
          await save(database, ids, { step: 'topics', topics: ['sports'] });
        });
        return ids;
      });
      await fixture.sql`delete from actors where id=${userId.actorId}`;
      await fixture.sql`delete from users where id=${userId.userId}`;
      assert({
        given: 'a member with answers in all three tables, then deleted',
        should: 'leave no onboarding rows behind',
        actual: [
          await fixture.count('member_interests', 'user_id', userId.userId),
          await fixture.count('member_topics', 'user_id', userId.userId),
          await fixture.count('member_onboarding', 'user_id', userId.userId),
        ],
        expected: [0, 0, 0],
      });
    });
  });
});
