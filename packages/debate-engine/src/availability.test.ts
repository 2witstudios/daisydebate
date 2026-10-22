import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  deriveOutageIntervals,
  effectiveAttendanceDeadline,
} from './availability';
setupRitewayBun();
const samples = (entries: readonly (readonly [number, boolean])[]) =>
  entries.map(([atMs, healthy]) => ({ atMs, healthy }));

test('outage starts after settled horizon and closes only on third healthy sample', () => {
  const evidence = samples([
    [0, true],
    [1000, true],
    [4000, true],
    [5000, true],
    [6000, true],
  ]);
  assert({
    given: 'a sampler gap followed by three healthy samples',
    should:
      'preserve the previous horizon and close at the third recovery sample',
    actual: deriveOutageIntervals(evidence),
    expected: {
      historyStartsAtMs: 0,
      settledHorizonMs: 6000,
      intervals: [{ startMs: 1001, endMs: 6000 }],
    },
  });
});

test('unhealthy evidence, missing prefix and unsettled tail postpone grace', () => {
  const availability = deriveOutageIntervals(
    samples([
      [10000, true],
      [11000, false],
      [12000, true],
      [13000, true],
      [14000, true],
      [15000, true],
    ]),
  );
  assert({
    given: 'history begins after opening',
    should: 'leave its deadline undetermined',
    actual: effectiveAttendanceDeadline({
      openedAtMs: 0,
      graceMs: 40000,
      availability,
    }),
    expected: null,
  });
  assert({
    given: 'a window reaches beyond the latest sample',
    should: 'never assume future availability',
    actual: effectiveAttendanceDeadline({
      openedAtMs: 10000,
      graceMs: 40000,
      availability,
    }),
    expected: null,
  });
});

test('deadline consumes healthy elapsed time across every encountered outage', () => {
  const availability = {
    historyStartsAtMs: 0,
    settledHorizonMs: 100000,
    intervals: [
      { startMs: 10000, endMs: 20000 },
      { startMs: 45000, endMs: 60000 },
    ],
  };
  assert({
    given:
      'second outage begins after nominal grace but before extended deadline',
    should: 'extend through both outages rather than one overlap pass',
    actual: effectiveAttendanceDeadline({
      openedAtMs: 0,
      graceMs: 40000,
      availability,
    }),
    expected: 65000,
  });
});

test('late samples up to two seconds do not open outages', () => {
  assert({
    given: 'consecutive healthy samples exactly two seconds apart',
    should: 'retain healthy history',
    actual: deriveOutageIntervals(
      samples([
        [0, true],
        [2000, true],
        [4000, true],
      ]),
    ),
    expected: { historyStartsAtMs: 0, settledHorizonMs: 4000, intervals: [] },
  });
});

test('availability refuses nonmonotonic samples', async () => {
  for (const at of [0, -1])
    await assertRejects({
      given: `sample at ${at} after zero`,
      should: 'refuse changing a settled prefix',
      actual: () =>
        deriveOutageIntervals(
          samples([
            [0, true],
            [at, false],
          ]),
        ),
      code: 'INVARIANT',
      invariantId: 'debate.availability.settled-prefix-stable',
    });
});

test('appending any healthy or unhealthy suffix preserves the settled prefix', () => {
  for (let mask = 0; mask < 32; mask++) {
    const prefix = Array.from({ length: 5 }, (_, i) => ({
      atMs: i * 1000,
      healthy: (mask & (1 << i)) !== 0,
    }));
    const before = deriveOutageIntervals(prefix);
    for (const gap of [1000, 2000, 3000])
      for (const healthy of [true, false]) {
        const after = deriveOutageIntervals([
          ...prefix,
          { atMs: 4000 + gap, healthy },
        ]);
        const unavailable = (result: typeof before, atMs: number) =>
          result.intervals.some(
            (i) => i.startMs <= atMs && (i.endMs === null || atMs < i.endMs),
          );
        assert({
          given: `prefix ${mask}, appended ${gap}/${healthy}`,
          should: 'preserve every settled millisecond',
          actual: Array.from({ length: 4001 }, (_, at) =>
            unavailable(after, at),
          ).every((value, at) => value === unavailable(before, at)),
          expected: true,
        });
      }
  }
});
