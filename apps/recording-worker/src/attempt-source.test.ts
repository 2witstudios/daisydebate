import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { attemptSource, runsOutsideLapses, WHOLE_FILE } from './attempt-source';

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

test('a lapse splits an attempt into the runs around it, and drops the whole file', () => {
  const entry = (at: number) => ({
    name: `s${at}.ts`,
    capturedAtMs: at * 4000,
    durationMs: 4000,
  });
  const entries = [0, 1, 2, 3, 4, 5, 6].map(entry);
  const names = new Set([...entries.map((e) => e.name), WHOLE_FILE]);
  assert({
    given: 'seven segments, a whole file, and a lapse over the middle',
    should: 'keep the runs clear of it by a margin, built from segments',
    actual: runsOutsideLapses(entries, names, [
      { fromMs: 10_000, toMs: 15_000 },
    ]).map((source) =>
      source.kind === 'segments'
        ? source.entries.map((e) => e.name)
        : source.kind,
    ),
    expected: [
      ['s0.ts', 's1.ts'],
      ['s4.ts', 's5.ts', 's6.ts'],
    ],
  });
});
