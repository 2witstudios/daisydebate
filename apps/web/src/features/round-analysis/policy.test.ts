import type { RoundAnalysisFacts } from '@daisy/db/rounds';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  roundAnalysisClaimDecision,
  roundAnalysisNeeded,
  roundAnalysisPolicy,
  roundAnalysisView,
} from './policy';

setupRitewayBun();

const completedAt = '2026-10-26T12:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(completedAt) + ms).toISOString();
const window = roundAnalysisPolicy.windowMs;
/** A seat of a Round that completed with frozen lines and no analysis yet. */
const facts = (
  overrides: Partial<RoundAnalysisFacts> = {},
): RoundAnalysisFacts => ({
  status: 'completed',
  completedAt,
  frozen: true,
  lines: 4,
  analysis: null,
  ...overrides,
});
const leased = (attempts: number, expiresInMs: number) =>
  ({
    status: 'leased',
    attempts,
    leaseExpiresAt: at(expiresInMs),
    report: null,
  }) as const;

describe('roundAnalysisNeeded()', () => {
  test('the window', () => {
    assert({
      given: 'a seat just inside, at, and past 24 hours',
      should: 'need an analysis only strictly inside the window',
      actual: [window - 1, window, window + 1].map((ms) =>
        roundAnalysisNeeded(facts(), at(ms)),
      ),
      expected: [true, false, false],
    });
  });
  test('the evidence', () => {
    assert({
      given:
        'a Round with no freeze, a freeze with no lines, one not completed, and one with no completion time',
      should: 'need no analysis: there is nothing to analyse',
      actual: [
        facts({ frozen: false }),
        facts({ lines: 0 }),
        facts({ status: 'active' }),
        facts({ completedAt: null }),
      ].map((f) => roundAnalysisNeeded(f, at(1))),
      expected: [false, false, false, false],
    });
  });
  test('no ballot enters the decision', () => {
    assert({
      given: 'the facts the decision reads',
      should: 'carry no ballot field at all',
      actual: Object.keys(facts()).some((key) => /ballot/i.test(key)),
      expected: false,
    });
  });
});

describe('roundAnalysisClaimDecision()', () => {
  test('a seat with no analysis', () => {
    assert({
      given: 'a seat that needs an analysis, then one that does not',
      should: 'claim the first and leave the second',
      actual: [
        roundAnalysisClaimDecision(facts(), at(1)),
        roundAnalysisClaimDecision(facts({ lines: 0 }), at(1)),
      ],
      expected: ['claim', 'skip'],
    });
  });
  test('a held lease and a finished analysis', () => {
    assert({
      given: 'a lease still held, and a finished analysis',
      should: 'leave both alone',
      actual: [
        roundAnalysisClaimDecision(
          facts({ analysis: leased(1, 60_000) }),
          at(1),
        ),
        roundAnalysisClaimDecision(
          facts({
            analysis: {
              status: 'succeeded',
              attempts: 1,
              leaseExpiresAt: null,
              report,
            },
          }),
          at(1),
        ),
      ],
      expected: ['skip', 'skip'],
    });
  });
  test('a lapsed lease', () => {
    assert({
      given:
        'a lapsed first attempt, a lapsed attempt at the cap, and a lapsed first attempt after the window',
      should:
        'retake the first, and end the spent one and the one that is no longer needed',
      actual: [
        roundAnalysisClaimDecision(
          facts({ analysis: leased(1, 1000) }),
          at(2000),
        ),
        roundAnalysisClaimDecision(
          facts({ analysis: leased(roundAnalysisPolicy.maxCalls, 1000) }),
          at(2000),
        ),
        roundAnalysisClaimDecision(
          facts({ analysis: leased(1, window) }),
          at(window + 1),
        ),
      ],
      expected: ['claim', 'fail', 'fail'],
    });
  });
});

describe('roundAnalysisView()', () => {
  const view = (f: RoundAnalysisFacts, entitled = true, enabled = true) =>
    roundAnalysisView({ facts: f, entitled, now: at(1000), enabled });
  test('without the entitlement', () => {
    assert({
      given: 'a debater without the entitlement, even with a stored report',
      should: 'be locked, carrying nothing',
      actual: view(
        facts({
          analysis: {
            status: 'succeeded',
            attempts: 1,
            leaseExpiresAt: null,
            report,
          },
        }),
        false,
      ),
      expected: { status: 'locked' },
    });
  });
  test('an analysis', () => {
    assert({
      given:
        'a succeeded analysis, one leased, one leased but lapsed at the cap, and one failed',
      should: 'show the report, pending, unavailable, and unavailable',
      actual: [
        view(
          facts({
            analysis: {
              status: 'succeeded',
              attempts: 1,
              leaseExpiresAt: null,
              report,
            },
          }),
        ),
        view(facts({ analysis: leased(1, 60_000) })),
        view(facts({ analysis: leased(roundAnalysisPolicy.maxCalls, 0) })),
        view(
          facts({
            analysis: {
              status: 'failed',
              attempts: 2,
              leaseExpiresAt: null,
              report: null,
            },
          }),
        ),
      ],
      expected: [
        { status: 'ready', report },
        { status: 'pending' },
        { status: 'unavailable' },
        { status: 'unavailable' },
      ],
    });
  });
  test('no analysis yet', () => {
    assert({
      given:
        'a seat needing an analysis with round analysis configured, then not configured, then one with no transcript',
      should: 'be pending only when an analysis will run',
      actual: [
        view(facts()),
        view(facts(), true, false),
        view(facts({ frozen: false })),
      ],
      expected: [
        { status: 'pending' },
        { status: 'unavailable' },
        { status: 'unavailable' },
      ],
    });
  });
});
