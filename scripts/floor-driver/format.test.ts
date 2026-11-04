import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { floorSelection, speechesFor } from './format';

setupRitewayBun();

test('the load format resolves as a real Room would', () => {
  const selection = floorSelection({ countdownMs: 1_000, speeches: 64 });
  const resolved = resolveRoomConfiguration(
    selection.definition,
    selection.config,
  );
  assert({
    given: 'the most speeches a format may have',
    should: 'resolve, with the countdown under test',
    actual: resolved.ok && [
      resolved.rules.segments.length,
      resolved.rules.countdownMs,
    ],
    expected: [64, 1_000],
  });
});

test('a Round plans only the speeches its share of the deadlines needs', () => {
  assert({
    given: 'few deadlines left',
    should: 'plan one more speech than deadlines, at least two',
    actual: [speechesFor(10), speechesFor(0), speechesFor(500)],
    expected: [11, 2, 64],
  });
});
