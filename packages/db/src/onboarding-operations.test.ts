import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const at = new Date('2026-10-05T12:00:00.000Z');
const actorId = 'a'.repeat(24);
const admitted = {
  userId: 'user-1',
  actorId,
  now: at.toISOString(),
  admits: () => true,
};
/** The account fence's row read; empty, so only the policy decides. */
const fence: never[] = [];

/** Which tables a run of queries wrote, in order, by statement kind. */
const writes = (queries: readonly { query: string }[]) =>
  queries
    .map(({ query }) => /^(insert into|delete from) "([a-z_]+)"/.exec(query))
    .filter((match) => match !== null)
    .map((match) => `${match[1]} ${match[2]}`);

describe('readOnboarding', () => {
  test('a member with nothing stored', async () => {
    const { database } = createTestDatabase([[], [], [], []]);
    assert({
      given: 'no onboarding row, interests or topics',
      should: 'read back empty answers',
      actual: await database.readOnboarding('user-1'),
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

  test('a member who answered everything', async () => {
    const { database, queries } = createTestDatabase([
      // The snapshot statement, then the three reads.
      [],
      // Schema-definition column order; the driver returns rows positionally.
      [['user-1', 'own', 'class', ['one-on-one'], at, at, at, 2]],
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
        completedAt: '2026-10-05T12:00:00.000Z',
        wants: ['debate', 'watch'],
        topics: ['law'],
      },
    });
    assert({
      given: 'the three reads',
      should:
        'run them in one read-only repeatable-read snapshot, so a save in between cannot mix answers',
      actual: queries[0]?.query.toLowerCase(),
      expected: 'set transaction isolation level repeatable read read only',
    });
  });
});

describe('saveOnboardingStep', () => {
  test('each step writes only its own tables', async () => {
    const about = createTestDatabase([fence, [], [], []]);
    await about.database.saveOnboardingStep({
      ...admitted,
      answers: {
        step: 'about',
        wants: ['judge'],
        club: 'starting',
      },
    });
    const emptyTopics = createTestDatabase([fence, [], []]);
    await emptyTopics.database.saveOnboardingStep({
      ...admitted,
      answers: { step: 'topics', topics: [] },
    });
    const experience = createTestDatabase([fence, []]);
    await experience.database.saveOnboardingStep({
      ...admitted,
      answers: {
        step: 'experience',
        experience: 'circuit',
        formats: ['teams'],
      },
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

describe('saveOnboardingStep without an admitted age', () => {
  test('refuses before any write', async () => {
    const { database, queries } = createTestDatabase([fence, [], [], []]);
    const seen: unknown[] = [];
    const refusal = await database
      .saveOnboardingStep({
        ...admitted,
        admits: (fact) => {
          seen.push(fact);
          return false;
        },
        answers: { step: 'about', wants: ['judge'], club: 'starting' },
      })
      .then(
        () => null,
        (error: { code?: string }) => error.code,
      );
    assert({
      given: 'an about step whose account fence finds no member',
      should:
        'take the fence, hand the policy an unknown fact, refuse and write nothing',
      actual: [
        queries[0]?.query.includes('daisy_authorization_accounts'),
        seen,
        refusal,
        writes(queries),
      ],
      expected: [true, [{ state: 'unknown' }], 'AUTHORIZATION', []],
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
