import {
  isProvisional,
  planRating,
  rateDebate,
  ratingAwaited,
  ratingEligibility,
} from '@daisy/debate-engine';
import {
  sideSeat,
  winnerOutcome,
  type DebaterStanding,
  type RatingEligibilityFacts,
  type WinnerOutcome,
} from '@daisy/protocol';
import { attempt } from './refusal';

const completedAt = '2026-10-06T10:00:00.000Z';
const affirmative = 'useraffirmative000000000';
const negative = 'usernegative000000000000';

/** Fixed standings: an established pair, a newcomer pair, and a returning one. */
const standings: Readonly<
  Record<string, Readonly<Record<string, DebaterStanding>>>
> = {
  established: {
    [affirmative]: {
      current: {
        state: { rating: 1620, deviation: 80, volatility: 0.06 },
        version: 7,
      },
      previous: null,
      lastRatedAt: '2026-10-01T10:00:00.000Z',
    },
    [negative]: {
      current: {
        state: { rating: 1540, deviation: 95, volatility: 0.059 },
        version: 3,
      },
      previous: null,
      lastRatedAt: '2026-09-20T10:00:00.000Z',
    },
  },
  provisional: {
    [affirmative]: { current: null, previous: null, lastRatedAt: null },
    [negative]: { current: null, previous: null, lastRatedAt: null },
  },
  carriedOver: {
    [affirmative]: {
      current: null,
      previous: { rating: 1810, deviation: 60, volatility: 0.05 },
      lastRatedAt: '2026-06-01T10:00:00.000Z',
    },
    [negative]: {
      current: {
        state: { rating: 1500, deviation: 300, volatility: 0.06 },
        version: 1,
      },
      previous: null,
      lastRatedAt: '2026-10-06T10:00:00.000Z',
    },
  },
};

const plan = (name: string, outcome: WinnerOutcome) => {
  const pair = standings[name]!;
  const result = attempt(() =>
    planRating({
      ladder: 'freestyle',
      outcome,
      occurredAt: completedAt,
      seasonId: 'season000000000000000001',
      seats: [
        { actorId: affirmative, seat: sideSeat('affirmative') },
        { actorId: negative, seat: sideSeat('negative') },
      ],
      standings: pair,
      changeIds: ['change000000000000000001', 'change000000000000000002'],
    }),
  );
  return {
    standings: name,
    outcome,
    plan: result,
    provisionalAfter: result.ok
      ? result.value.changes.map((change) =>
          isProvisional(change.after.deviation),
        )
      : null,
  };
};

const completed: RatingEligibilityFacts = {
  competitionType: 'ranked',
  ladderId: 'freestyle',
  status: 'completed',
  outcome: winnerOutcome('affirmative'),
  completedAt,
  alreadyRated: false,
  ending: 'judged',
  attendance: {
    ruleSegments: [],
    speeches: [],
    adjudications: [],
    receipts: [],
    pendingWriter: false,
  },
};

/** Eligibility over a completed ranked Round, one fact varied at a time. */
const eligibility = () => {
  const cases: readonly (readonly [string, RatingEligibilityFacts])[] = [
    ['rated', completed],
    ['negative-wins', { ...completed, outcome: winnerOutcome('negative') }],
    ['null-outcome', { ...completed, outcome: null }],
    ['casual', { ...completed, competitionType: 'casual', ladderId: null }],
    ['abandoned', { ...completed, status: 'abandoned', outcome: null }],
    ['already-rated', { ...completed, alreadyRated: true }],
    ['forfeit', { ...completed, ending: 'forfeit' }],
    ['unjudged', { ...completed, ending: 'unjudged' }],
    ['unrecorded', { ...completed, ending: 'unrecorded' }],
    [
      'check-in-pending',
      {
        ...completed,
        attendance: { ...completed.attendance, pendingWriter: true },
      },
    ],
    [
      'attendance-unsettled',
      {
        ...completed,
        attendance: {
          ...completed.attendance,
          ruleSegments: [
            { key: 'first', type: 'speech' },
            { key: 'last', type: 'speech' },
          ],
          speeches: [
            { id: 's1', rulesSegmentKey: 'first', startedAt: completedAt },
          ],
        },
      },
    ],
    [
      'active',
      { ...completed, status: 'active', completedAt: null, outcome: null },
    ],
  ];
  return cases.map(([name, facts]) => ({
    name,
    facts,
    eligibility: attempt(() => ratingEligibility(facts)),
    awaited: ratingAwaited(facts),
  }));
};

/** One debate rated directly, with both sides' idle widening. */
const direct = (outcome: WinnerOutcome) =>
  rateDebate({
    affirmative: {
      state: { rating: 1500, deviation: 200, volatility: 0.06 },
      lastRatedAt: '2026-09-06T10:00:00.000Z',
    },
    negative: {
      state: { rating: 1700, deviation: 50, volatility: 0.06 },
      lastRatedAt: null,
    },
    outcome,
    occurredAt: completedAt,
  });

/** Every rating case, by corpus file name. */
export const ratingCases = (): readonly (readonly [string, unknown])[] => [
  ['eligibility', eligibility()],
  [
    'plans',
    Object.keys(standings).flatMap((name) => [
      plan(name, winnerOutcome('affirmative')),
      plan(name, winnerOutcome('negative')),
    ]),
  ],
  [
    'rate-debate',
    {
      affirmative: direct(winnerOutcome('affirmative')),
      negative: direct(winnerOutcome('negative')),
    },
  ],
];
