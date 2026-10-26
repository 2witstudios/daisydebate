import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { BoundedTransaction } from './bounded-transaction';
import {
  createRoundFeedbackJobs,
  readRoundFeedbackFacts,
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
      [],
      [{ roundId: 'r1' }, { roundId: 'r2' }],
    ]);
    await assertRejects({
      given: 'a batch limit outside 1 to 64',
      should: 'refuse with VALIDATION',
      actual: () => jobs.scan(65),
      code: 'VALIDATION',
    });
    assert({
      given: 'two Rounds needing coaching',
      should: 'end spent leases first, then list the Rounds',
      actual: { listed: await jobs.scan(8), left: left() },
      expected: { listed: ['r1', 'r2'], left: 0 },
    });
  });

  test('a Round that may not be claimed', async () => {
    const { jobs } = jobsWith([[], [{ open: false }]]);
    assert({
      given: 'a Round already held, coached or ineligible',
      should: 'claim nothing',
      actual: await jobs.claim('r1'),
      expected: null,
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
    [{ open: true }],
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
    const claim = await jobs.claim('r1');
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
      actual: () => jobs.claim('r1'),
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

describe('readRoundFeedbackFacts()', () => {
  test('a stored pass and none', async () => {
    const reader = (rows: unknown[]) =>
      ({ execute: async () => rows }) as never;
    assert({
      given: 'a succeeded pass, then a Round with no row',
      should: 'return its validated coaching, then nothing but eligibility',
      actual: [
        await readRoundFeedbackFacts(
          reader([{ status: 'succeeded', feedback: coaching, eligible: true }]),
          'r1',
        ),
        await readRoundFeedbackFacts(
          reader([{ status: null, feedback: null, eligible: false }]),
          'r1',
        ),
      ],
      expected: [
        { status: 'succeeded', feedback: coaching, eligible: true },
        { status: null, feedback: null, eligible: false },
      ],
    });
  });
});
