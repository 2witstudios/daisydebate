import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { BoundedTransaction } from './bounded-transaction';
import {
  createRoundFeedbackJobs,
  readRoundCoachingFacts,
  type RoundCoachingFacts,
} from './round-feedback';

setupRitewayBun();

/** A query builder chain that resolves to `result` whichever methods it is called with. */
const chain = (result: unknown): unknown =>
  new Proxy(() => undefined, {
    get: (_target, key) =>
      key === 'then'
        ? (ok: (value: unknown) => void, no: (error: unknown) => void) =>
            Promise.resolve(result).then(ok, no)
        : () => chain(result),
  });

/** A transaction answering each statement, in order, from `answers`. */
const scripted = (answers: unknown[]) => {
  const queue = [...answers];
  const next = () => queue.shift();
  const tx = {
    execute: async () => next(),
    select: () => chain(next()),
    insert: () => chain(next()),
    update: () => chain(next()),
  };
  const run: BoundedTransaction = (work) =>
    work(tx as never, new AbortController().signal, {} as never);
  return { run, left: () => queue.length };
};

const accessRow = {
  roundId: 'r1',
  createdByActorId: null,
  visibility: 'public',
  status: 'completed',
  revision: 1,
  participants: [],
};
const token = 't'.repeat(43);
const coaching = {
  affirmative: 'Weigh your access impact first.',
  negative: 'Answer the access turn.',
};
const jobsWith = (answers: unknown[]) => {
  const script = scripted(answers);
  return {
    ...script,
    jobs: createRoundFeedbackJobs({
      run: script.run,
      nextToken: () => token,
      leaseMs: 30000,
      model: 'judge-model',
    }),
  };
};

/** The facts row as the driver returns it, and the plain facts it becomes. */
const factsRow = {
  status: 'completed',
  completed_at: new Date('2026-10-26T12:00:00.000Z'),
  frozen: true,
  lines: '2',
  ai_ballots: [
    { submitted: true, sides: ['negative', 'not-a-side'] },
    { submitted: false, sides: [] },
  ],
  pass: {
    status: 'leased',
    attempts: 1,
    leaseExpiresAt: '2026-10-26T12:02:00+00:00',
    feedback: null,
  },
};
const plainFacts: RoundCoachingFacts = {
  status: 'completed',
  completedAt: '2026-10-26T12:00:00.000Z',
  frozen: true,
  lines: 2,
  aiBallots: [
    { submitted: true, sides: ['negative'] },
    { submitted: false, sides: [] },
  ],
  pass: {
    status: 'leased',
    attempts: 1,
    leaseExpiresAt: '2026-10-26T12:02:00.000Z',
    feedback: null,
  },
};

describe('createRoundFeedbackJobs()', () => {
  test('refuses an unusable configuration', async () => {
    for (const [given, leaseMs, model] of [
      ['a zero lease', 0, 'judge-model'],
      ['a lease over two minutes', 120_001, 'judge-model'],
      ['a blank model', 30000, ' '],
    ] as const)
      await assertRejects({
        given,
        should: 'refuse with VALIDATION',
        actual: async () =>
          createRoundFeedbackJobs({
            run: scripted([]).run,
            nextToken: () => token,
            leaseMs,
            model,
          }),
        code: 'VALIDATION',
      });
  });

  test('scan', async () => {
    const { jobs, left } = jobsWith([
      [{ roundId: 'r1' }, { roundId: 'r2' }],
      [accessRow],
      [{ ...accessRow, roundId: 'r2' }],
    ]);
    for (const [given, limit, since] of [
      ['a batch limit outside 1 to 64', 65, '2026-10-25T12:00:00.000Z'],
      ['an unreadable window start', 8, 'yesterday-ish'],
    ] as const)
      await assertRejects({
        given,
        should: 'refuse with VALIDATION',
        actual: () => jobs.scan(limit, since, () => true),
        code: 'VALIDATION',
      });
    assert({
      given: 'two candidate Rounds',
      should: 'list them in one statement, deciding nothing',
      actual: {
        listed: await jobs.scan(8, '2026-10-25T12:00:00.000Z', () => true),
        left: left(),
      },
      expected: { listed: ['r1', 'r2'], left: 0 },
    });
  });

  test('the decision leaves or ends a Round', async () => {
    const seen: RoundCoachingFacts[] = [];
    const skipped = jobsWith([[], [accessRow], [factsRow]]);
    const ended = jobsWith([[], [accessRow], [factsRow], undefined]);
    assert({
      given: 'a decision to leave the Round, then one to end its lapsed lease',
      should:
        'hand the decision the Round’s plain facts and claim nothing either way',
      actual: {
        skipped: await skipped.jobs.claim('r1', (facts) => {
          seen.push(facts);
          return 'skip';
        }),
        ended: await ended.jobs.claim('r1', () => 'fail'),
        left: [skipped.left(), ended.left()],
        facts: seen,
      },
      expected: {
        skipped: null,
        ended: null,
        left: [0, 0],
        facts: [plainFacts],
      },
    });
  });

  const freeze = {
    roundId: 'r1',
    revision: 1,
    frontier: 1,
    frozenAt: new Date('2026-10-26T12:00:00.000Z'),
    completeness: 'complete',
  };
  const line = {
    id: 'u1',
    segmentId: 's1',
    segmentSequence: 0,
    sequence: 0,
    roundParticipantId: 'p1',
    text: 'Access improves.',
    complete: true,
  };
  const claimAnswers = (claimed: unknown) => [
    [],
    [accessRow],
    [factsRow],
    [freeze],
    [],
    [line],
    [claimed],
    [{ resolution: 'Transit should be free' }],
    [{ id: 'p1', role: 'affirmative', slot: 0 }],
    [{ id: 's1', sequence: 0 }],
  ];

  test('a claim reads the freeze it is bound to', async () => {
    const { jobs, left } = jobsWith(
      claimAnswers({ attempts: 1, freezeRevision: 1 }),
    );
    const claim = await jobs.claim('r1', () => 'claim');
    assert({
      given: 'a claimable Round frozen at revision 1',
      should:
        'take its next attempt and return the token, model, Round and frozen lines to coach',
      actual: {
        token: claim?.token,
        attempt: claim?.attempt,
        model: claim?.model,
        round: claim?.round,
        lines: claim?.frozen.utterances,
        left: left(),
      },
      expected: {
        token,
        attempt: 1,
        model: 'judge-model',
        round: {
          id: 'r1',
          resolution: 'Transit should be free',
          participants: [{ id: 'p1', role: 'affirmative', slot: 0 }],
          segments: [{ id: 's1', sequence: 0 }],
        },
        lines: [line],
        left: 0,
      },
    });
  });

  test('a claim whose row names another freeze', async () => {
    const { jobs } = jobsWith(claimAnswers({ attempts: 2, freezeRevision: 2 }));
    await assertRejects({
      given: 'a stored attempt bound to a different freeze revision',
      should: 'refuse with INVARIANT',
      actual: () => jobs.claim('r1', () => 'claim'),
      code: 'INVARIANT',
    });
  });

  test('usage and results', async () => {
    const { jobs } = jobsWith([undefined, [], [{ roundId: 'r1' }]]);
    await assertRejects({
      given: 'a negative token count',
      should: 'refuse with VALIDATION',
      actual: () =>
        jobs.recordUsage('r1', token, { inputTokens: -1, outputTokens: 0 }),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'coaching for one side only',
      should: 'refuse with VALIDATION',
      actual: () =>
        jobs.complete('r1', token, { affirmative: coaching.affirmative }),
      code: 'VALIDATION',
    });
    await jobs.recordUsage('r1', token, { inputTokens: 10, outputTokens: 2 });
    await assertRejects({
      given: 'a result whose lease has gone',
      should: 'refuse with CONFLICT',
      actual: () => jobs.complete('r1', token, coaching),
      code: 'CONFLICT',
    });
    assert({
      given: 'a result while the lease holds',
      should: 'store it',
      actual: await jobs.complete('r1', token, coaching),
      expected: undefined,
    });
  });
});

describe('readRoundCoachingFacts()', () => {
  test('a Round’s facts, or none', async () => {
    const reader = (rows: unknown[]) =>
      ({ execute: async () => rows }) as never;
    assert({
      given: 'the driver’s row for a Round',
      should:
        'return plain facts: instants as UTC ISO, the line count as a number, only real sides',
      actual: await readRoundCoachingFacts(reader([factsRow]), 'r1'),
      expected: plainFacts,
    });
    await assertRejects({
      given: 'no Round',
      should: 'refuse with NOT_FOUND',
      actual: () => readRoundCoachingFacts(reader([]), 'r1'),
      code: 'NOT_FOUND',
    });
  });
});
