import { assert, setupRitewayBun, test } from 'riteway/bun';
import { clockInstantProblems } from './clock-instants';

setupRitewayBun();

const at = (ms: number) => new Date(Date.UTC(2026, 10, 27) + ms).toISOString();
const now = Date.UTC(2026, 10, 28);

test('a kill during prep leaves prep ending at its budget (INTX-19)', () => {
  const prep = {
    moment: 'mid-prep' as const,
    prepStartedAt: at(0),
    prepRemainingMs: 60_000,
    budgetMsPerSide: 120_000,
    consumedAfterMs: 120_000,
    stops: [{ from: at(20_000), to: at(25_000) }],
  };
  assert({
    given:
      'prep with a minute left, a 5 s incident inside it, and the speech opening one microphone lead after its shifted end, then 2 s early, then never',
    should: 'accept the first, and name the early start and the missing one',
    actual: [
      clockInstantProblems({ ...prep, nextStartedAt: at(66_200) }, now),
      clockInstantProblems({ ...prep, nextStartedAt: at(64_200) }, now).length,
      clockInstantProblems({ ...prep, nextStartedAt: null }, now).length,
    ],
    expected: [[], 1, 1],
  });
  assert({
    given: 'prep that ended with budget left over',
    should: 'say the budget was not spent at its end',
    actual: clockInstantProblems(
      { ...prep, consumedAfterMs: 90_000, nextStartedAt: at(66_200) },
      now,
    ),
    expected: ['prep: 90000 ms spent, not the whole 120000 ms budget'],
  });
});

test('a kill during cross-examination leaves its due instant and gives no prep back (INTX-19)', () => {
  const cx = {
    moment: 'mid-cx' as const,
    startedAt: at(0),
    durationMs: 180_000,
    returnedMs: 4_000,
    consumedBeforeMs: { affirmative: 30_000, negative: 0 },
    consumedAfterMs: { affirmative: 30_000, negative: 0 },
  };
  assert({
    given:
      'cross-examination closing at its duration plus returned airtime, then a second late, then with prep returned',
    should: 'accept the first and name each fault',
    actual: [
      clockInstantProblems({ ...cx, endedAt: at(184_000) }, now),
      clockInstantProblems({ ...cx, endedAt: at(185_000) }, now).length,
      clockInstantProblems(
        {
          ...cx,
          endedAt: at(184_000),
          consumedAfterMs: { affirmative: 10_000, negative: 0 },
        },
        now,
      ),
    ],
    expected: [[], 1, ['cross-examination: returned prep to affirmative']],
  });
});

test('a kill during a point of information returns the floor at its limit or at the pause (INTX-19)', () => {
  const point = {
    moment: 'mid-poi' as const,
    acceptedAt: at(90_000),
    maxDurationMs: 15_000,
  };
  assert({
    given:
      'a point with no incident returning at its limit, one a pause ended, and one that returned late',
    should: 'accept the first two and name the third',
    actual: [
      clockInstantProblems(
        { ...point, stops: [], holderEndedAt: at(105_000) },
        now,
      ),
      clockInstantProblems(
        {
          ...point,
          stops: [{ from: at(97_000), to: at(110_000) }],
          holderEndedAt: at(97_000),
        },
        now,
      ),
      clockInstantProblems(
        { ...point, stops: [], holderEndedAt: at(106_000) },
        now,
      ).length,
    ],
    expected: [[], [], 1],
  });
});
