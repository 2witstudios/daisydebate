import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const at = new Date('2026-10-05T12:00:00.000Z');

/** Which tables a run of queries wrote, in order, by statement kind. */
const writes = (queries: readonly { query: string }[]) =>
  queries
    .map(({ query }) => /^(insert into|delete from) "([a-z_]+)"/.exec(query))
    .filter((match) => match !== null)
    .map((match) => `${match[1]} ${match[2]}`);

describe('readOnboarding', () => {
  test('a member with nothing stored', async () => {
    const { database } = createTestDatabase([[], [], []]);
    assert({
      given: 'no onboarding row, interests or topics',
      should: 'read back empty answers',
      actual: await database.readOnboarding('user-1'),
      expected: {
        wants: [],
        club: null,
        experience: null,
        formats: [],
        length: null,
        topics: [],
        completedAt: null,
      },
    });
  });

  test('a member who answered everything', async () => {
    const { database } = createTestDatabase([
      // Schema-definition column order; the driver returns rows positionally.
      [['user-1', 'own', 'class', ['one-on-one'], 'quick', at, at, at, 2]],
      [['debate'], ['watch']],
      [['law']],
    ]);
    assert({
      given: 'a stored row, two interests and a topic',
      should: 'map them with completion as a UTC ISO string',
      actual: await database.readOnboarding('user-1'),
      expected: {
        club: 'own',
        experience: 'class',
        formats: ['one-on-one'],
        length: 'quick',
        completedAt: '2026-10-05T12:00:00.000Z',
        wants: ['debate', 'watch'],
        topics: ['law'],
      },
    });
  });
});

describe('saveOnboardingStep', () => {
  test('each step writes only its own tables', async () => {
    const about = createTestDatabase([[], [], []]);
    await about.database.saveOnboardingStep('user-1', {
      step: 'about',
      wants: ['judge'],
      club: 'starting',
    });
    const emptyTopics = createTestDatabase([[], []]);
    await emptyTopics.database.saveOnboardingStep('user-1', {
      step: 'topics',
      topics: [],
    });
    const experience = createTestDatabase([[]]);
    await experience.database.saveOnboardingStep('user-1', {
      step: 'experience',
      experience: 'circuit',
      formats: ['teams'],
      length: 'full',
    });
    assert({
      given: 'an about step, an empty topics step and an experience step',
      should:
        'replace interests, clear topics, and touch only the answers row for experience',
      actual: [
        writes(about.queries),
        writes(emptyTopics.queries),
        writes(experience.queries),
      ],
      expected: [
        [
          'insert into member_onboarding',
          'delete from member_interests',
          'insert into member_interests',
        ],
        ['insert into member_onboarding', 'delete from member_topics'],
        ['insert into member_onboarding'],
      ],
    });
  });
});

describe('completeOnboarding', () => {
  test('keeps the first finish', async () => {
    const { database, queries } = createTestDatabase([[]]);
    await database.completeOnboarding('user-1', at);
    assert({
      given: 'a finish at a time',
      should: 'upsert it, keeping an earlier completion if there is one',
      actual: [
        writes(queries),
        queries[0]?.query.includes(
          'coalesce("member_onboarding"."completed_at"',
        ),
      ],
      expected: [['insert into member_onboarding'], true],
    });
  });
});
