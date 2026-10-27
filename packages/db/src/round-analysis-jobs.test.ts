import { assertRejects } from '@daisy/errors/testing';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readRoundAnalysisFacts } from './round-analysis-facts';
import { createRoundAnalysisJobs } from './round-analysis-jobs';
import type { RoundAnalysisFacts } from './round-analysis-facts';
import { scripted } from './bounded-script.test-support';

setupRitewayBun();

const seat = { roundId: 'r1', roundParticipantId: 'p1' };
const accessRow = {
  roundId: 'r1',
  createdByActorId: null,
  visibility: 'public',
  status: 'completed',
  revision: 1,
  participants: [
    {
      id: 'p1',
      actorId: 'a1aaaaaaaaaaaaaaaaaaaaaa',
      role: 'affirmative',
      slot: 0,
      userId: 'u1aaaaaaaaaaaaaaaaaaaaaa',
    },
    { id: 'p2', actorId: 'a2', role: 'negative', slot: 0, userId: null },
    {
      id: 'p3',
      actorId: 'a3',
      role: 'judge',
      slot: 0,
      userId: 'u3aaaaaaaaaaaaaaaaaaaaaa',
    },
  ],
};
/** The canonical account fence's row for u1 (a claim reads it under its lock). */
const accountRow = {
  userId: 'u1aaaaaaaaaaaaaaaaaaaaaa',
  actorId: 'a1aaaaaaaaaaaaaaaaaaaaaa',
  member: true,
  erased: false,
  revision: 1,
  betaState: 'approved',
  betaRevision: 1,
  ageBand: 'adult',
};
const token = 't'.repeat(43);
const jobsWith = (answers: unknown[]) => {
  const script = scripted(answers);
  return {
    ...script,
    jobs: createRoundAnalysisJobs({
      run: script.run,
      nextToken: () => token,
      leaseMs: 60_000,
      model: 'analysis-model',
    }),
  };
};

/** The facts row as the driver returns it, and the plain facts it becomes. */
const factsRow = {
  status: 'completed',
  completed_at: new Date('2026-10-26T12:00:00.000Z'),
  frozen: true,
  lines: '2',
  analysis: {
    status: 'leased',
    attempts: 1,
    leaseExpiresAt: '2026-10-26T12:02:00+00:00',
    report: null,
  },
};
const plainFacts: RoundAnalysisFacts = {
  status: 'completed',
  completedAt: '2026-10-26T12:00:00.000Z',
  frozen: true,
  lines: 2,
  analysis: {
    status: 'leased',
    attempts: 1,
    leaseExpiresAt: '2026-10-26T12:02:00.000Z',
    report: null,
  },
};

describe('createRoundAnalysisJobs()', () => {
  test('refuses an unusable configuration', async () => {
    for (const [given, leaseMs, model] of [
      ['a zero lease', 0, 'analysis-model'],
      ['a lease over three minutes', 180_001, 'analysis-model'],
      ['a blank model', 30000, ' '],
    ] as const)
      await assertRejects({
        given,
        should: 'refuse with VALIDATION',
        actual: async () =>
          createRoundAnalysisJobs({
            run: scripted([]).run,
            nextToken: () => token,
            leaseMs,
            model,
          }),
        code: 'VALIDATION',
      });
  });

  test('subject erasure refuses an analysis before deciding or spending an attempt', async () => {
    const { jobs, left } = jobsWith([[], [{ erased: true }]]);
    let decisions = 0;
    const claimed = await jobs.claim(seat, () => {
      decisions++;
      return 'claim';
    });
    assert({
      given: 'a Round whose participant was erased before a claim',
      should: 'refuse even an unconditional claim without buying an attempt',
      actual: { claimed, decisions, left: left() },
      expected: { claimed: null, decisions: 0, left: 0 },
    });
  });

  test('scan', async () => {
    const { jobs, left } = jobsWith([
      [
        { roundId: 'r1', roundParticipantId: 'p1' },
        { roundId: 'r2', roundParticipantId: 'p4' },
      ],
      [accessRow],
      [],
      [],
      [
        {
          ...accessRow,
          roundId: 'r2',
          participants: [{ ...accessRow.participants[0]!, id: 'p4' }],
        },
      ],
      [],
      [],
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
    const seen: string[] = [];
    assert({
      given: 'two candidate seats, one denied by the feature',
      should: 'list only the permitted seat, deciding nothing itself',
      actual: {
        listed: await jobs.scan(8, '2026-10-25T12:00:00.000Z', (access) => {
          seen.push(`${access.seat.side}:${access.seat.id}`);
          return access.round.roundId === 'r1';
        }),
        seen,
        left: left(),
      },
      expected: {
        listed: [seat],
        seen: ['affirmative:p1', 'affirmative:p4'],
        left: 0,
      },
    });
  });

  test('a seat that is not a human debater is never analysed', async () => {
    for (const roundParticipantId of ['p2', 'p3'])
      await assertRejects({
        given: `seat ${roundParticipantId} (a bot debater, then a judge)`,
        should: 'refuse with NOT_FOUND before any decision',
        actual: () =>
          jobsWith([[], [{ erased: false }], [accessRow]]).jobs.claim(
            { roundId: 'r1', roundParticipantId },
            () => 'claim',
          ),
        code: 'NOT_FOUND',
      });
  });

  test('the decision leaves or ends a seat', async () => {
    const seen: RoundAnalysisFacts[] = [];
    const answers = () => [
      [],
      [{ erased: false }],
      [accessRow],
      [accountRow],
      [],
      [factsRow],
    ];
    const skipped = jobsWith(answers());
    const ended = jobsWith([...answers(), undefined]);
    assert({
      given: 'a decision to leave the seat, then one to end its lapsed lease',
      should:
        'hand the decision the seat’s plain facts and claim nothing either way',
      actual: {
        skipped: await skipped.jobs.claim(seat, (facts) => {
          seen.push(facts);
          return 'skip';
        }),
        ended: await ended.jobs.claim(seat, () => 'fail'),
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
  const claimAnswers = (claimed: unknown, history: unknown[]) => [
    [],
    [{ erased: false }],
    [accessRow],
    [accountRow],
    [],
    [factsRow],
    [freeze],
    [{ revision: 1 }],
    [],
    [line],
    [claimed],
    [{ resolution: 'Transit should be free' }],
    [{ id: 'p1', role: 'affirmative', slot: 0 }],
    [{ id: 's1', sequence: 0 }],
    history,
  ];

  test('a claim reads the freeze it is bound to and the debater’s own history', async () => {
    const { jobs, left } = jobsWith(
      claimAnswers({ attempts: 1, freezeRevision: 1 }, [{ report }]),
    );
    const claim = await jobs.claim(seat, () => 'claim');
    assert({
      given: 'a claimable seat frozen at revision 1 with one earlier analysis',
      should:
        'take its next attempt and return the token, seat, Round, frozen lines and earlier skill scores',
      actual: {
        token: claim?.token,
        attempt: claim?.attempt,
        model: claim?.model,
        seat: claim?.seat,
        lines: claim?.frozen.utterances,
        history: claim?.history,
        left: left(),
      },
      expected: {
        token,
        attempt: 1,
        model: 'analysis-model',
        seat: { ...seat, side: 'affirmative', slot: 0 },
        lines: [line],
        history: [
          Object.fromEntries(
            Object.entries(report.skills).map(([skill, { score }]) => [
              skill,
              score,
            ]),
          ),
        ],
        left: 0,
      },
    });
  });

  test('a claim whose row names another freeze', async () => {
    const { jobs } = jobsWith(
      claimAnswers({ attempts: 2, freezeRevision: 2 }, []),
    );
    await assertRejects({
      given: 'a stored attempt bound to a different freeze revision',
      should: 'refuse with INVARIANT',
      actual: () => jobs.claim(seat, () => 'claim'),
      code: 'INVARIANT',
    });
  });

  test('usage and results', async () => {
    const { jobs } = jobsWith([undefined, [], [{ roundId: 'r1' }]]);
    await assertRejects({
      given: 'a negative token count',
      should: 'refuse with VALIDATION',
      actual: () =>
        jobs.recordUsage(seat, token, { inputTokens: -1, outputTokens: 0 }),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'two sentences instead of a report',
      should: 'refuse with VALIDATION',
      actual: () =>
        jobs.complete(seat, token, {
          affirmative: 'Weigh first.',
        } as never),
      code: 'VALIDATION',
    });
    await jobs.recordUsage(seat, token, { inputTokens: 10, outputTokens: 2 });
    await assertRejects({
      given: 'a report whose lease has gone',
      should: 'refuse with CONFLICT',
      actual: () => jobs.complete(seat, token, report),
      code: 'CONFLICT',
    });
    assert({
      given: 'a report while the lease holds',
      should: 'store it',
      actual: await jobs.complete(seat, token, report),
      expected: undefined,
    });
  });
});

describe('readRoundAnalysisFacts()', () => {
  test('a seat’s facts, or none', async () => {
    const reader = (rows: unknown[]) =>
      ({ execute: async () => rows }) as never;
    assert({
      given: 'the driver’s row for a seat',
      should:
        'return plain facts: instants as UTC ISO and the line count as a number',
      actual: await readRoundAnalysisFacts(reader([factsRow]), seat),
      expected: plainFacts,
    });
    assert({
      given: 'a succeeded analysis with its report',
      should: 'return the validated report',
      actual: (
        await readRoundAnalysisFacts(
          reader([
            {
              ...factsRow,
              analysis: {
                status: 'succeeded',
                attempts: 1,
                leaseExpiresAt: null,
                report,
              },
            },
          ]),
          seat,
        )
      ).analysis?.report,
      expected: report,
    });
    await assertRejects({
      given: 'no Round',
      should: 'refuse with NOT_FOUND',
      actual: () => readRoundAnalysisFacts(reader([]), seat),
      code: 'NOT_FOUND',
    });
  });
});
