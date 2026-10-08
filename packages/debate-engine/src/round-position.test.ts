import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { advancedClockRowsOf, clockRowsOf } from './round-position';
import {
  emptyCheckpoint,
  practiceRules,
  roundAt,
} from './runtime.test-support';

setupRitewayBun();

const rules = practiceRules();
const started = Date.parse(roundAt(0));
const active = {
  status: 'active' as const,
  startedAtMs: started,
  completedAtMs: null,
  outcome: null,
  gapAnchorMs: started,
};

describe('browser clock projection', () => {
  test('converts durable stamps and virtually crosses expired segments without mutating them', () => {
    const persisted = [
      {
        id: 'first',
        sequence: 0,
        type: 'speech' as const,
        rulesSegmentKey: 'AC',
        startedAt: roundAt(10_000),
        endedAt: null,
        durationMs: 300_000,
      },
    ];
    const rows = clockRowsOf(persisted);
    const projected = advancedClockRowsOf(
      rows,
      emptyCheckpoint,
      active,
      rules,
      started + 440_000,
    );
    assert({
      given:
        'a durable opening speech and a clock past the next segment deadline',
      should:
        'close the speech at its exact deadline and virtually open the next segment',
      actual: projected.rows.map((row) => [
        row.key,
        row.startedAtMs - started,
        row.endedAtMs === null ? null : row.endedAtMs - started,
      ]),
      expected: [
        ['AC', 10_000, 310_000],
        ['CX1', 320_000, 440_000],
      ],
    });
    assert({
      given: 'a read-only browser projection',
      should: 'leave the hydrated database rows unchanged',
      actual: rows[0]?.endedAtMs,
      expected: null,
    });
  });

  test('expires active prep into the next segment without another countdown', () => {
    const checkpoint = {
      ...emptyCheckpoint,
      active_prep: {
        side: 'affirmative' as const,
        started_at: roundAt(945_000),
      },
      prep_consumed_ms: { affirmative: 60_000, negative: 0 },
    };
    const prior = rules.segments.slice(0, 4).map((segment, sequence) => ({
      id: `closed-${sequence}`,
      sequence,
      type: segment.type,
      key: segment.key,
      startedAtMs: started,
      endedAtMs: started + 940_000,
      durationMs: segment.durationMs,
    }));
    const projected = advancedClockRowsOf(
      prior,
      checkpoint,
      active,
      rules,
      started + 1_125_000,
    );
    assert({
      given:
        'preparation whose remaining budget expired at the current instant',
      should: 'open the spendable speech at expiry and consume the full budget',
      actual: [
        projected.rows.at(-1)?.key,
        projected.rows.at(-1)?.startedAtMs,
        projected.checkpoint.active_prep,
        projected.checkpoint.prep_consumed_ms.affirmative,
      ],
      expected: ['1AR', started + 1_125_000, null, 240_000],
    });
  });

  test('keeps the final segment open for the ballot and leaves a scheduled round inert', () => {
    const final = rules.segments.at(-1)!;
    const row = {
      id: 'last',
      sequence: rules.segments.length - 1,
      type: final.type,
      key: final.key,
      startedAtMs: started,
      endedAtMs: null,
      durationMs: final.durationMs,
    };
    assert({
      given: 'the final segment after its deadline',
      should: 'keep its row open until completion records a ballot',
      actual: advancedClockRowsOf(
        [row],
        emptyCheckpoint,
        active,
        rules,
        started + final.durationMs + 1,
      ).rows,
      expected: [row],
    });
    assert({
      given: 'a scheduled round before any start command',
      should: 'materialize no virtual segments',
      actual: advancedClockRowsOf(
        [],
        emptyCheckpoint,
        { ...active, status: 'scheduled' },
        rules,
        started + 1_000_000,
      ).rows,
      expected: [],
    });
  });
});
