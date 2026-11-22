import fc from 'fast-check';
import { seededCheck } from '@daisy/seeded-random/testing';
import {
  adjudicateAttendance,
  assertAttendanceRules,
  attendancePolicy,
  deriveOutageIntervals,
  effectiveAttendanceDeadline,
  rateDebate,
  ratePeriod,
  ratingPolicy,
  requireAttendanceDecision,
  requireAttendanceWindow,
} from '@daisy/debate-engine';
import type { RoundRules } from '@daisy/protocol/format';
import { refusalOf, type OracleFormat } from './round-oracle.test-support';

/**
 * Properties over generated inputs for the ids the engine raises outside the
 * Round's own runtime: its rules policy, ratings and attendance. Each states
 * the condition its id guards from the policy constants alone, and holds
 * the public function to refusing exactly when that condition fails.
 */
export type OracleProperty = {
  readonly id: string;
  readonly claim: string;
  /** The shrunk failure, or null when the property held. */
  readonly check: (formats: readonly OracleFormat[]) => string | null;
};

/** The id a call refused with, `accepted`, or what else it threw. */
const outcomeOf = (run: () => unknown): string => {
  try {
    run();
    return 'accepted';
  } catch (error) {
    const refusal = refusalOf(error);
    return refusal.kind === 'invariant'
      ? refusal.id
      : refusal.kind === 'app'
        ? `app ${refusal.code}`
        : `stray ${refusal.error}`;
  }
};

const expectOutcome = (
  label: string,
  actual: string,
  expected: string,
): readonly string[] =>
  actual === expected ? [] : [`${label}: ${actual}, expected ${expected}`];

const { graceMs, leadMs, finalizationBufferMs } = attendancePolicy;

// ---- Rules policy ----

const timingPolicy = fc.record({
  heartbeatMs: fc.integer({ min: 1, max: 30_000 }),
  reconnectBudgetMs: fc.integer({ min: 0, max: 30_000 }),
  graceMs: fc.integer({ min: 1, max: 120_000 }),
  commitBudgetMs: fc.integer({ min: 0, max: 10_000 }),
  finalizationBufferMs: fc.integer({ min: 0, max: 10_000 }),
});

/** The first rule a policy and a format break, in the order the ids guard them. */
const expectedRulesOutcome = (
  rules: RoundRules,
  policy: {
    readonly heartbeatMs: number;
    readonly reconnectBudgetMs: number;
    readonly graceMs: number;
    readonly commitBudgetMs: number;
    readonly finalizationBufferMs: number;
  },
): string => {
  if (policy.graceMs < 2 * policy.heartbeatMs + policy.reconnectBudgetMs)
    return 'debate.rules.check-in-grace-covers-reconnect';
  if (
    rules.segments.some(
      (segment) =>
        segment.type === 'speech' && segment.durationMs < policy.graceMs,
    )
  )
    return 'debate.rules.speech-covers-grace';
  if (policy.finalizationBufferMs <= policy.commitBudgetMs)
    return 'debate.rules.finalization-buffer-covers-commit';
  return 'accepted';
};

const rulesProperty = (id: string, claim: string): OracleProperty => ({
  id,
  claim,
  check: (formats) =>
    seededCheck({
      seed: 7,
      runs: 600,
      input: fc.tuple(fc.nat({ max: formats.length - 1 }), timingPolicy),
      problems: ([index, policy]) => {
        const { rules, name } = formats[index]!;
        return [
          ...expectOutcome(
            `${name} under the deployed policy`,
            outcomeOf(() => assertAttendanceRules(rules)),
            'accepted',
          ),
          ...expectOutcome(
            `${name} under ${JSON.stringify(policy)}`,
            outcomeOf(() => assertAttendanceRules(rules, policy)),
            expectedRulesOutcome(rules, policy),
          ),
        ];
      },
    }).failure,
});

// ---- Ratings ----

const { bounds } = ratingPolicy;
const ratingState = fc.record({
  rating: fc.oneof(
    fc.double({ min: bounds.rating.min, max: bounds.rating.max, noNaN: true }),
    fc.double({ min: -1_000, max: 10_000 }),
  ),
  deviation: fc.oneof(
    fc.double({
      min: bounds.deviation.min,
      max: bounds.deviation.max,
      noNaN: true,
    }),
    fc.double({ min: -100, max: 1_000 }),
  ),
  volatility: fc.oneof(
    // ISSUE-1498 is pinned separately for values whose square underflows.
    fc.double({ min: 1e-8, max: bounds.volatility.max, noNaN: true }),
    fc.double({ min: -0.1, max: 0 }),
    fc.double({ min: bounds.volatility.max, max: 1 }),
    fc.constant(Number.NaN),
  ),
});

/** ISSUE-1498: the ledger accepts a positive input whose square rounds to zero. */
export const ratingVolatilityUnderflow = () => {
  const state = { rating: 1_500, deviation: 100, volatility: Number.MIN_VALUE };
  const rating = { state, lastRatedAt: null };
  return rateDebate({
    affirmative: rating,
    negative: rating,
    outcome: { kind: 'winner', side: 'affirmative' },
    occurredAt: '2026-11-19T09:00:00.000Z',
  }).affirmative.after.volatility;
};
type RatingState = { rating: number; deviation: number; volatility: number };

const inBounds = (state: RatingState) =>
  Number.isFinite(state.rating) &&
  Number.isFinite(state.deviation) &&
  Number.isFinite(state.volatility) &&
  state.rating >= bounds.rating.min &&
  state.rating <= bounds.rating.max &&
  state.deviation >= bounds.deviation.min &&
  state.deviation <= bounds.deviation.max &&
  state.volatility > 0 &&
  state.volatility <= bounds.volatility.max;

const ratingBounded: OracleProperty = {
  id: 'debate.rating.state-bounded',
  claim:
    'a rating refuses exactly the states outside the ledger bounds, and every rating it makes is inside them',
  check: () =>
    seededCheck({
      seed: 11,
      runs: 800,
      input: fc.tuple(ratingState, ratingState, fc.boolean()),
      problems: ([affirmative, negative, affirmativeWins]) => {
        const input = {
          affirmative: { state: affirmative, lastRatedAt: null },
          negative: { state: negative, lastRatedAt: null },
          outcome: {
            kind: 'winner',
            side: affirmativeWins ? 'affirmative' : 'negative',
          } as const,
          occurredAt: '2026-11-19T09:00:00.000Z',
        };
        const expected =
          inBounds(affirmative) && inBounds(negative)
            ? 'accepted'
            : 'debate.rating.state-bounded';
        const outcome = outcomeOf(() => rateDebate(input));
        const problems = [
          ...expectOutcome(
            `rating ${JSON.stringify(input)}`,
            outcome,
            expected,
          ),
        ];
        if (expected === 'accepted' && outcome === 'accepted') {
          const rated = rateDebate(input);
          for (const side of ['affirmative', 'negative'] as const) {
            const result = rated[side].after;
            if (!inBounds(result))
              problems.push(
                `${side} left the bounds: ${JSON.stringify(result)}`,
              );
          }
        }
        return problems;
      },
    }).failure,
};

const glickoState = fc.record({
  rating: fc.double({ min: 0, max: 4_000, noNaN: true }),
  deviation: fc.double({ min: 1, max: 500, noNaN: true }),
  volatility: fc.double({ min: 0.001, max: 0.2, noNaN: true }),
});
const games = fc.array(
  fc.record({
    opponent: fc.record({
      rating: fc.double({ min: 0, max: 4_000, noNaN: true }),
      deviation: fc.double({ min: 1, max: 500, noNaN: true }),
    }),
    score: fc.constantFrom(0 as const, 1 as const),
  }),
  { minLength: 1, maxLength: 5 },
);

const volatilityConverges: OracleProperty = {
  id: 'debate.rating.volatility-converges',
  claim:
    'under the deployed bound the volatility search always converges to a finite state, and a search cut short is refused, never returned',
  check: () =>
    seededCheck({
      seed: 13,
      runs: 600,
      input: fc.tuple(glickoState, games),
      problems: ([player, played]) => {
        const config = {
          tau: ratingPolicy.tau,
          epsilon: ratingPolicy.epsilon,
          maxIterations: ratingPolicy.maxIterations,
        };
        const problems: string[] = [];
        const full = outcomeOf(() => ratePeriod(player, played, config));
        if (full !== 'accepted')
          problems.push(`the deployed search refused: ${full}`);
        else {
          const next = ratePeriod(player, played, config);
          if (
            ![next.rating, next.deviation, next.volatility].every(
              Number.isFinite,
            ) ||
            next.deviation <= 0 ||
            next.volatility <= 0
          )
            problems.push(`the search returned ${JSON.stringify(next)}`);
        }
        // Equal ratings predict 0.5. For one game this puts the initial
        // bracket endpoints tau apart, so a zero iteration budget must fail.
        const equalMatch = [{ opponent: player, score: 1 as const }];
        problems.push(
          ...expectOutcome(
            'a full search for an even match',
            outcomeOf(() => ratePeriod(player, equalMatch, config)),
            'accepted',
          ),
          ...expectOutcome(
            'an even match with no iterations',
            outcomeOf(() =>
              ratePeriod(player, equalMatch, { ...config, maxIterations: 0 }),
            ),
            'debate.rating.volatility-converges',
          ),
        );
        return problems;
      },
    }).failure,
};

// ---- Availability ----

const samples = fc.array(
  fc.record({
    gapMs: fc.integer({ min: -50, max: 40_000 }),
    healthy: fc.boolean(),
  }),
  { maxLength: 40 },
);

const settledPrefixStable: OracleProperty = {
  id: 'debate.availability.settled-prefix-stable',
  claim:
    'samples that do not strictly increase are refused, and an outage closed in a prefix of the history stays exactly as it was',
  check: () =>
    seededCheck({
      seed: 17,
      runs: 600,
      input: samples,
      problems: (steps) => {
        let atMs = 1_000_000;
        const history = steps.map(({ gapMs, healthy }) => {
          atMs += gapMs;
          return { atMs, healthy };
        });
        const increasing = history.every(
          (sample, index) =>
            index === 0 || sample.atMs > history[index - 1]!.atMs,
        );
        const outcome = outcomeOf(() => deriveOutageIntervals(history));
        if (!increasing)
          return expectOutcome(
            'a history out of order',
            outcome,
            'debate.availability.settled-prefix-stable',
          );
        if (outcome !== 'accepted')
          return [`an ordered history refused: ${outcome}`];
        const whole = deriveOutageIntervals(history);
        const problems: string[] = [];
        if (whole.settledHorizonMs !== (history.at(-1)?.atMs ?? null))
          problems.push('the horizon is not the last sample');
        for (let length = 0; length <= history.length; length += 1) {
          const prefix = deriveOutageIntervals(history.slice(0, length));
          for (const interval of prefix.intervals)
            if (
              interval.endMs !== null &&
              !whole.intervals.some(
                (other) =>
                  other.startMs === interval.startMs &&
                  other.endMs === interval.endMs,
              )
            )
              problems.push(
                `an outage closed after ${length} samples moved later`,
              );
        }
        return problems;
      },
    }).failure,
};

// ---- Attendance ----

const seats = [
  { id: 'speaker0000000000000000', side: 'affirmative' },
  { id: 'opponent000000000000000', side: 'negative' },
  { id: 'teammate000000000000000', side: 'affirmative' },
] as const;
const OPENED_MS = 10_000_000;

const windowOf = (lastSpeech: boolean) => ({
  segmentId: 'speech00000000000000000',
  openedAtMs: OPENED_MS,
  speakerId: seats[0].id,
  speakerSide: 'affirmative' as const,
  forfeitsTo: 'negative' as const,
  eligibleSeats: [...seats],
  lastSpeech,
});

/** Health known with no outage from before the opening up to `horizonMs`. */
const healthyThrough = (horizonMs: number) => ({
  historyStartsAtMs: OPENED_MS - 60_000,
  settledHorizonMs: horizonMs,
  intervals: [],
});

const checkInWindowOpen: OracleProperty = {
  id: 'debate.check-in.window-open',
  claim:
    'a check-in is taken exactly inside an unresolved speech’s window: from the lead before its opening to its grace after',
  check: () =>
    seededCheck({
      seed: 19,
      runs: 800,
      input: fc.record({
        offsetMs: fc.integer({ min: -2 * leadMs, max: 2 * graceMs }),
        finalized: fc.boolean(),
        terminal: fc.boolean(),
      }),
      problems: ({ offsetMs, finalized, terminal }) => {
        const receivedAtMs = OPENED_MS + offsetMs;
        const open =
          !finalized && !terminal && offsetMs >= -leadMs && offsetMs <= graceMs;
        return expectOutcome(
          `a check-in ${offsetMs} ms from the opening`,
          outcomeOf(() =>
            requireAttendanceWindow({
              window: windowOf(false),
              availability: healthyThrough(OPENED_MS + 10 * graceMs),
              receivedAtMs,
              finalized,
              terminal,
            }),
          ),
          open ? 'accepted' : 'debate.check-in.window-open',
        );
      },
    }).failure,
};

const evidence = fc.record({
  finalized: fc.boolean(),
  speech: fc.boolean(),
  lastSpeech: fc.boolean(),
  /** How long after the deadline health is known; negative is unsettled. */
  settledAfterMs: fc.integer({ min: -graceMs, max: 3 * finalizationBufferMs }),
  /** The speaker's receipt relative to the opening; null for none. */
  receiptMs: fc.option(fc.integer({ min: -2 * leadMs, max: 2 * graceMs })),
  witness: fc.constantFrom('opponent', 'teammate', null),
  nowMs: fc.integer({ min: 0, max: 10 * graceMs }),
  claimed: fc.constantFrom(
    'on-time',
    'attended',
    'none',
    'forfeit',
    'abandoned',
  ),
});
type Evidence = typeof evidence extends fc.Arbitrary<infer T> ? T : never;

const evidenceOf = (input: Evidence) => ({
  window: windowOf(input.lastSpeech),
  availability: healthyThrough(
    OPENED_MS + graceMs + finalizationBufferMs + input.settledAfterMs,
  ),
  finalized: input.finalized,
  segmentType: input.speech ? ('speech' as const) : ('cross_ex' as const),
  checkIns: [
    ...(input.receiptMs === null
      ? []
      : [
          {
            participantId: seats[0].id,
            receivedAtMs: OPENED_MS + input.receiptMs,
          },
        ]),
    ...(input.witness === null
      ? []
      : [
          {
            participantId:
              input.witness === 'opponent' ? seats[1].id : seats[2].id,
            receivedAtMs: OPENED_MS,
          },
        ]),
  ],
  botSeatIds: [],
  cutoffAtMs: null,
  nowMs: OPENED_MS + input.nowMs,
});

const claimedDecision = (input: Evidence) => {
  const settled = {
    evidence: 'settled_availability' as const,
    effectiveDeadlineMs: OPENED_MS + graceMs,
    settledHorizonMs:
      OPENED_MS + graceMs + finalizationBufferMs + input.settledAfterMs,
  };
  switch (input.claimed) {
    case 'on-time':
      return {
        evidence: 'on_time_receipt' as const,
        decision: 'attended' as const,
        participantId: seats[0].id,
        receivedAtMs: OPENED_MS + (input.receiptMs ?? 0),
      };
    case 'attended':
      return { ...settled, decision: 'attended' as const };
    case 'none':
      return { ...settled, decision: 'none' as const };
    case 'abandoned':
      return { ...settled, decision: 'abandoned' as const };
    case 'forfeit':
      return {
        ...settled,
        decision: 'forfeit' as const,
        winner: 'negative' as const,
      };
  }
};

/**
 * What the evidence decides, from the policy alone: a receipt inside the
 * base window attends. After health settles, a receipt from the other side
 * earns a forfeit, a same-side witness keeps play going, and an empty round
 * is abandoned.
 */
const decidedBy = (input: Evidence): Evidence['claimed'] | 'undecided' => {
  const onTime =
    input.receiptMs !== null &&
    input.receiptMs >= -leadMs &&
    input.receiptMs <= graceMs;
  if (onTime) return 'on-time';
  if (input.settledAfterMs < 0) return 'undecided';
  switch (input.witness) {
    case 'opponent':
      return 'forfeit';
    case 'teammate':
      return 'none';
    case null:
      return 'abandoned';
  }
};

const expectedDecisionOutcome = (input: Evidence): string => {
  if (input.finalized) return 'debate.adjudication.finalized-irreversible';
  if (!input.speech) return 'debate.adjudication.speech-turns-only';
  if (input.lastSpeech) return 'debate.adjudication.last-speech-never-forfeits';
  const decided = decidedBy(input);
  if (decided === 'undecided')
    return 'debate.adjudication.failure-postpones-only';
  return decided === input.claimed
    ? 'accepted'
    : 'debate.adjudication.timestamp-decides';
};

const attendanceProperty = (id: string, claim: string): OracleProperty => ({
  id,
  claim,
  check: () =>
    seededCheck({
      seed: 23,
      runs: 1_500,
      input: evidence,
      problems: (input) => {
        const problems = [
          ...expectOutcome(
            `a ${input.claimed} claim on ${JSON.stringify(input)}`,
            outcomeOf(() =>
              requireAttendanceDecision(
                evidenceOf(input),
                claimedDecision(input),
              ),
            ),
            expectedDecisionOutcome(input),
          ),
        ];
        if (!input.finalized) {
          const decision = adjudicateAttendance(evidenceOf(input));
          // The last speech never forfeits, and nothing unsettled decides an absence.
          if (input.lastSpeech && decision !== null)
            problems.push('the last speech was adjudicated');
          if (
            decision !== null &&
            decision.evidence === 'settled_availability' &&
            input.settledAfterMs < 0
          )
            problems.push('unsettled health decided an absence');
          // Receipt timestamps decide, never the evaluator's clock.
          const later = adjudicateAttendance({
            ...evidenceOf(input),
            nowMs: OPENED_MS + input.nowMs + 3_600_000,
          });
          if (!Bun.deepEquals(decision, later))
            problems.push('the decision moved with the evaluator’s clock');
        }
        return problems;
      },
    }).failure,
});

const failurePostponesOnly: OracleProperty = {
  ...attendanceProperty(
    'debate.adjudication.failure-postpones-only',
    'unsettled health only postpones: it never decides an absence, and timing that is not positive integer milliseconds is refused',
  ),
  check: (formats) => {
    const decisions = attendanceProperty('', '').check(formats);
    if (decisions !== null) return decisions;
    return seededCheck({
      seed: 29,
      runs: 400,
      input: fc.tuple(
        fc.oneof(
          fc.integer({ min: -1_000, max: 120_000 }),
          fc.double({ noNaN: false }),
        ),
        fc.oneof(
          fc.integer({ min: -1_000, max: 1_000_000 }),
          fc.double({ noNaN: false }),
        ),
      ),
      problems: ([grace, opened]) =>
        expectOutcome(
          `grace ${grace} at ${opened}`,
          outcomeOf(() =>
            effectiveAttendanceDeadline({
              openedAtMs: opened,
              graceMs: grace,
              availability: healthyThrough(opened + 10 * Math.abs(grace)),
            }),
          ),
          Number.isSafeInteger(grace) &&
            grace > 0 &&
            Number.isSafeInteger(opened)
            ? 'accepted'
            : 'debate.adjudication.failure-postpones-only',
        ),
    }).failure;
  },
};

export const oracleProperties: readonly OracleProperty[] = [
  rulesProperty(
    'debate.rules.check-in-grace-covers-reconnect',
    'the policy refuses grace shorter than two heartbeats and a reconnect',
  ),
  rulesProperty(
    'debate.rules.speech-covers-grace',
    'every format’s speeches cover the grace, and a policy whose grace outlasts a speech is refused',
  ),
  rulesProperty(
    'debate.rules.finalization-buffer-covers-commit',
    'the policy refuses a finalization buffer that does not exceed the commit budget',
  ),
  ratingBounded,
  volatilityConverges,
  settledPrefixStable,
  checkInWindowOpen,
  attendanceProperty(
    'debate.adjudication.finalized-irreversible',
    'a finalized decision is never made again',
  ),
  attendanceProperty(
    'debate.adjudication.speech-turns-only',
    'only an actual speech carries an attendance decision',
  ),
  attendanceProperty(
    'debate.adjudication.last-speech-never-forfeits',
    'the last speech is never adjudicated',
  ),
  attendanceProperty(
    'debate.adjudication.timestamp-decides',
    'receipt timestamps and settled health decide, and a decision that disagrees is refused',
  ),
  failurePostponesOnly,
];
