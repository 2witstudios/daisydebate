import { assert, setupRitewayBun, test } from 'riteway/bun';
import { dueAfterStops, runningMs } from './clock-stops';
setupRitewayBun();
const at = (ms: number) => new Date(ms).toISOString();
const stop = (from: number, to: number | null) => ({
  from: at(from),
  to: to === null ? null : at(to),
});
test('dueAfterStops', () => {
  const table: readonly [string, readonly ReturnType<typeof stop>[], number][] =
    [
      ['no stop', [], 1500],
      ['a stop before the anchor', [stop(100, 900)], 1500],
      ['a stop inside the wait', [stop(1100, 1300)], 1700],
      ['a stop straddling the anchor', [stop(900, 1100)], 1600],
      ['a stop after the due instant', [stop(1500, 1800)], 1500],
      [
        'a second stop the first one pushed the wait into',
        [stop(1100, 1300), stop(1600, 1650)],
        1750,
      ],
    ];
  for (const [given, stops, expected] of table)
    assert({
      given,
      should: 'move the due instant by only the time the clock lost',
      actual: dueAfterStops(1000, 500, stops, 2000),
      expected,
    });
  assert({
    given: 'a stop still open',
    should: 'keep the due instant ahead of now, however late now is',
    actual: dueAfterStops(1000, 500, [stop(1200, null)], 9000) > 9000,
    expected: true,
  });
});
test('runningMs', () => {
  assert({
    given: 'a stop inside the span',
    should: 'not count it',
    actual: runningMs(1000, 2000, [stop(1200, 1500)]),
    expected: 700,
  });
  assert({
    given: 'a stop that outlasts now',
    should: 'count only up to where the clock stopped',
    actual: runningMs(1000, 2000, [stop(1500, 2600)]),
    expected: 500,
  });
  assert({
    given: 'an open stop',
    should: 'freeze the running time',
    actual: [2000, 9000].map((now) => runningMs(1000, now, [stop(1500, null)])),
    expected: [500, 500],
  });
});
