import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextBoundary } from './context';
setupRitewayBun();
const current = {
  sourceKey: 'a'.repeat(64),
  startOffsetMs: 100,
  durationMs: 250,
  lastSequence: 24,
  units: 1,
};
const next = {
  sourceKey: 'a'.repeat(64),
  startOffsetMs: 350,
  durationMs: 250,
  firstSequence: 25,
  lastSequence: 49,
};
test('recognition context joins only actual original contiguous units within declared bounds', () => {
  const cases = [
    next,
    { ...next, sourceKey: 'b'.repeat(64) },
    { ...next, startOffsetMs: 360 },
    { ...next, firstSequence: 26 },
    { ...next, startOffsetMs: 340 },
    { ...next, durationMs: 30000 },
  ];
  assert({
    given:
      'same-run consecutive receipt units, another original epoch/run, a time gap, missing sequence, overlap or oversized context',
    should:
      'append only the genuine bounded original continuation without inventing a bridge',
    actual: cases.map((unit) => contextBoundary(current, unit)),
    expected: ['append', 'new', 'new', 'new', 'new', 'new'],
  });
});
test('recognition context unit count and duration bound are independent of durability cadence', () => {
  assert({
    given: 'a full thirty-second context or 128 tiny genuine units',
    should:
      'start a new recognition context while preserving the prior one, with no silence/completeness assertion',
    actual: [
      contextBoundary(
        { ...current, durationMs: 30000 },
        { ...next, startOffsetMs: 30100 },
      ),
      contextBoundary({ ...current, units: 128 }, next),
      contextBoundary(null, next),
    ],
    expected: ['new', 'new', 'new'],
  });
});
