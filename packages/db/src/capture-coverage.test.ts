import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  hasCompleteCaptureCoverage,
  type CaptureInterval,
  type CoverageEdges,
} from './capture-coverage';

setupRitewayBun();
const range = (start: number, end: number | null): CaptureInterval => ({
  start,
  end,
});
const exact: CoverageEdges = { openMs: 0, closeMs: 0 };
const closed = {
  authority: [range(1000, 2000), range(3000, 4000)],
  observed: [range(500, 1500), range(1500, 2500), range(2900, 4100)],
  tolerance: exact,
  storedChunks: 2,
  expectedChunks: 2,
};
/** Whether `authority` seals complete for `observed` under `tolerance`. */
const complete = (
  authority: readonly CaptureInterval[],
  observed: readonly CaptureInterval[],
  tolerance: CoverageEdges,
) =>
  hasCompleteCaptureCoverage({
    authority,
    observed,
    tolerance,
    storedChunks: 1,
    expectedChunks: 1,
  });

test('a seal requires every closed historical window and matching committed chunks', () => {
  assert({
    given:
      'adjacent observations spanning all windows with actual chunk counts',
    should: 'seal complete only when no window, coverage or chunk is missing',
    actual: [
      closed,
      { ...closed, observed: [range(500, 1499), range(1500, 4100)] },
      { ...closed, expectedChunks: 3 },
      { ...closed, authority: [range(1000, null)] },
      { ...closed, authority: [] },
      { ...closed, observed: [range(500, 2500)] },
    ].map(hasCompleteCaptureCoverage),
    expected: [true, false, false, false, false, false],
  });
});

test('overlapping unordered observations cover silence without inventing empty window authority', () => {
  assert({
    given:
      'zero-length provenance plus a real window with no recognized speech',
    should: 'allow complete silent coverage but refuse malformed evidence',
    actual: [
      {
        ...closed,
        authority: [range(1000, 1000), range(2000, 3000)],
        observed: [range(2500, 3100), range(1900, 2600)],
        storedChunks: 0,
        expectedChunks: 0,
      },
      { ...closed, authority: [range(1000, 1000)] },
      { ...closed, observed: [range(500, null)] },
      { ...closed, observed: [range(500, Number.NaN)] },
      { ...closed, storedChunks: -1, expectedChunks: -1 },
    ].map(hasCompleteCaptureCoverage),
    expected: [true, false, false, false, false],
  });
});

test('speech begins at the first captured frame inside the open zone (DEC-218)', () => {
  const sealed = (observed: readonly CaptureInterval[]) =>
    complete([range(1000, 6000)], observed, { openMs: 2000, closeMs: 0 });
  assert({
    given:
      'capture from inside the open zone with a dropout after it, from its edge, from just past it, none, and only before the window',
    should:
      'seal complete only when capture is contiguous from where speech began',
    actual: [
      sealed([range(4000, 6000), range(2500, 3900)]),
      sealed([range(3000, 6000)]),
      sealed([range(3001, 6000)]),
      sealed([]),
      sealed([range(500, 900)]),
    ],
    expected: [false, true, false, false, false],
  });
});

test('time after speech ended is forgiven only inside the close zone (DEC-220)', () => {
  const sealed = (observed: readonly CaptureInterval[]) =>
    complete([range(1000, 6000)], observed, { openMs: 0, closeMs: 500 });
  assert({
    given:
      'capture ending inside the close zone, at its edge, before it, none, past the close, and only before the window opens',
    should: 'seal complete only when capture reaches into the close zone',
    actual: [
      sealed([range(1000, 3000), range(3000, 5800)]),
      sealed([range(1000, 5500)]),
      sealed([range(1000, 5499)]),
      sealed([]),
      sealed([range(1000, 6200)]),
      complete([range(6000, 7000)], [range(5000, 6000)], {
        openMs: 0,
        closeMs: 1500,
      }),
    ],
    expected: [true, true, false, false, true, false],
  });
});

test('a window shorter than its zones still needs a captured frame inside it', () => {
  assert({
    given:
      'a short credited window whose only nearby capture belongs to the next window, and the same window with one frame inside it',
    should: 'seal partial without a frame in the window, complete with one',
    actual: [
      complete([range(1000, 1500), range(1800, 3000)], [range(1800, 3000)], {
        openMs: 1000,
        closeMs: 0,
      }),
      complete(
        [range(1000, 1500), range(1800, 3000)],
        [range(1400, 1450), range(1800, 3000)],
        { openMs: 1000, closeMs: 500 },
      ),
    ],
    expected: [false, true],
  });
});

test('a capture restart after speech ended inside the close zone keeps the window complete (#493)', () => {
  assert({
    given:
      'a window whose capture ends inside its close zone, then capture resumes after it',
    should: 'seal complete: the later capture never moves where speech ended',
    actual: complete(
      [range(30000, 30100)],
      [range(4900, 30050), range(31000, 60000)],
      { openMs: 0, closeMs: 1000 },
    ),
    expected: true,
  });
});

// Credited windows as a bot publishes them: short unions with gaps, ending at the cutoff 60000.
const windows = [
  range(5000, 5100),
  range(30000, 30100),
  range(59500, 59600),
  range(59888, 60000),
];
const bot: CoverageEdges = {
  openMs: 1000,
  closeMs: 1000,
  terminalCloseMs: 1000,
};

test('a bot’s last credited window seals complete whichever side of the final frame it starts (ISSUE-806)', () => {
  assert({
    given:
      'contiguous capture from the first window whose final frame lands inside the last window, then before it, near the cutoff',
    should:
      'seal complete both ways: what follows the final frame within the terminal zone is the relay lag, not missing speech',
    actual: [
      complete(windows, [range(4900, 59950)], bot),
      complete(windows, [range(4900, 59853)], bot),
    ],
    expected: [true, true],
  });
});

test('more capture near the cutoff never flips a bot’s complete stream to partial (ISSUE-807)', () => {
  assert({
    given:
      'capture that reaches the terminal zone, the same plus a short fragment after it, and the same plus a frame straddling the cutoff',
    should: 'seal complete every time',
    actual: [
      complete(windows, [range(4900, 59100)], bot),
      complete(windows, [range(4900, 59100), range(59700, 59750)], bot),
      complete(windows, [range(4900, 59100), range(59950, 60400)], bot),
    ],
    expected: [true, true, true],
  });
});

test('the terminal zone never forgives speech that was not captured (ISSUE-806, ISSUE-807)', () => {
  assert({
    given:
      'capture that stopped before the terminal zone, a gap in capture mid-speech, a final window whose every frame precedes it, and capture in the zone that carries no credited speech',
    should: 'still seal partial',
    actual: [
      complete(windows, [range(4900, 58000)], bot),
      complete(windows, [range(4900, 20000), range(31000, 59950)], bot),
      complete([range(6000, 7000)], [range(5000, 6000)], bot),
      complete(windows, [range(4900, 58000), range(59650, 59700)], bot),
    ],
    expected: [false, false, false, false],
  });
});

test('a human grant whose microphone dies in its last second still seals partial (ISSUE-806)', () => {
  // A human's grants carry no terminal zone.
  const human = (observed: readonly CaptureInterval[]) =>
    complete([range(0, 58500), range(59200, 60000)], observed, {
      openMs: 4000,
      closeMs: 1000,
    });
  assert({
    given:
      'a human whose capture ends before a short final grant opens, and one captured through it',
    should: 'seal the dead final grant partial, and the captured one complete',
    actual: [human([range(0, 59100)]), human([range(0, 59950)])],
    expected: [false, true],
  });
});

/** Deterministic xorshift32: reproducible cases, no ambient randomness. */
const generator = (seed: number) => {
  let state = seed;
  return (below: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % below;
  };
};
const arbitraryRanges = (next: (below: number) => number, count: number) =>
  Array.from({ length: count }, () => {
    const start = next(12_000);
    return range(start, start + 1 + next(4_000));
  });

test('captured evidence added near the cutoff never flips complete to partial (ISSUE-807)', () => {
  const next = generator(0x5eed807);
  const flips: string[] = [];
  for (let i = 0; i < 4_000; i++) {
    const authority = arbitraryRanges(next, 1 + next(4));
    const observed = arbitraryRanges(next, next(5));
    const tolerance =
      i % 2 === 0
        ? { openMs: next(2_000), closeMs: next(2_000) }
        : {
            openMs: next(2_000),
            closeMs: next(2_000),
            terminalCloseMs: next(2_000),
          };
    // Past every open zone: evidence that cannot move where speech began.
    const after = Math.max(...authority.map((w) => w.start)) + tolerance.openMs;
    const start = after + next(4_000);
    const extra = range(start, start + 1 + next(2_000));
    if (
      complete(authority, observed, tolerance) &&
      !complete(authority, [...observed, extra], tolerance)
    )
      flips.push(JSON.stringify({ authority, observed, extra, tolerance }));
  }
  assert({
    given:
      '4,000 seeded authority, evidence and tolerance cases, each with one extra observation past every open zone',
    should: 'never seal partial where less evidence sealed complete',
    actual: flips.slice(0, 3),
    expected: [],
  });
});
