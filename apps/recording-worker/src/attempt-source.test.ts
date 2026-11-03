import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { attemptSource, continuousRuns } from './attempt-source';

setupRitewayBun();

const entries = [0, 1, 2].map((n) => ({
  name: `s_${n}.ts`,
  capturedAtMs: 1000 + n * 4000,
  durationMs: 4000,
}));

describe('attemptSource', () => {
  test('prefers the whole file a clean Egress wrote', () => {
    assert({
      given: 'a whole file and segments',
      should: 'use the file, timed from the first segment',
      actual: attemptSource(entries, new Set(['full.mp4', 's_0.ts'])),
      expected: { kind: 'whole_file', startedAtMs: 1000 },
    });
  });
  test('falls back to segments when Egress crashed', () => {
    assert({
      given: 'segments with one missing and no file',
      should: 'use those before the hole and nothing after it',
      actual: attemptSource(entries, new Set(['s_0.ts', 's_1.ts', 's_3.ts'])),
      expected: {
        kind: 'segments',
        startedAtMs: 1000,
        entries: entries.slice(0, 2),
      },
    });
  });
  test('states when an attempt left nothing usable', () => {
    assert({
      given: 'no playlist entries, even with a file',
      should: 'be absent: a file with no capture time has no place',
      actual: attemptSource([], new Set(['full.mp4'])),
      expected: { kind: 'absent' },
    });
    assert({
      given: 'entries with no objects',
      should: 'be absent',
      actual: attemptSource(entries, new Set()),
      expected: { kind: 'absent' },
    });
  });
});

test('a hole left by stripping splits the runs; a small seam does not', () => {
  const entry = (name: string, capturedAtMs: number) => ({
    name,
    capturedAtMs,
    durationMs: 4000,
  });
  assert({
    given: 'segments following on within a seam, then after a 12 s hole',
    should: 'give two runs',
    actual: continuousRuns([
      entry('a', 0),
      entry('b', 4100),
      entry('c', 20_000),
    ]).map((run) => run.map(({ name }) => name)),
    expected: [['a', 'b'], ['c']],
  });
});
