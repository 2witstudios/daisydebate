import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideMediaRead, type MediaReadEvent } from './media-read-intent';
setupRitewayBun();

const initial = {
  roundViewVersion: 3,
  deadlineMs: null,
  generation: 0,
  disposed: false,
};
test('new view and boundary are distinct read intents', () => {
  const boundary = decideMediaRead(initial, {
    kind: 'boundary',
    roundViewVersion: 3,
    deadlineMs: 60000,
  });
  const view = decideMediaRead(boundary.intent, {
    kind: 'view',
    roundViewVersion: 4,
  });
  assert({
    given: 'a due boundary then a newer accepted view',
    should:
      'advance separate intent tickets and reset the boundary key on a newer view',
    actual: [boundary.action, boundary.intent, view.action, view.intent],
    expected: [
      'supersede',
      { ...initial, deadlineMs: 60000, generation: 1 },
      'supersede',
      { ...initial, roundViewVersion: 4, generation: 2 },
    ],
  });
});
test('old duplicate malformed and disposed events are inert', () => {
  const intent = { ...initial, deadlineMs: 60000 };
  const events: MediaReadEvent[] = [
    ...[2, 3, -1, 3.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(
      (roundViewVersion) => ({ kind: 'view' as const, roundViewVersion }),
    ),
    ...[60000, 59999, NaN, Infinity, 60000.5, Number.MAX_SAFE_INTEGER + 1].map(
      (deadlineMs) => ({
        kind: 'boundary' as const,
        roundViewVersion: 3,
        deadlineMs,
      }),
    ),
    { kind: 'boundary', roundViewVersion: 2, deadlineMs: 70000 },
    { kind: 'boundary', roundViewVersion: 4, deadlineMs: 70000 },
  ];
  const disposed = { ...intent, disposed: true };
  assert({
    given: 'non-advancing or malformed keys and a disposed lifetime',
    should: 'retain identical state without scheduling work',
    actual: [
      events.every((event) => {
        const next = decideMediaRead(intent, event);
        return next.intent === intent && next.action === 'ignore';
      }),
      [...events, { kind: 'wake' } as const].every(
        (event) =>
          decideMediaRead(disposed, event).intent === disposed &&
          decideMediaRead(disposed, event).action === 'ignore',
      ),
    ],
    expected: [true, true],
  });
});
test('wake keeps authority and dispose is terminal', () => {
  const wake = decideMediaRead(initial, { kind: 'wake' });
  const stop = decideMediaRead(initial, { kind: 'dispose' });
  assert({
    given: 'a same-intent wake then disposal',
    should: 'nudge without minting authority and invalidate on disposal',
    actual: [wake.action, wake.intent === initial, stop.action, stop.intent],
    expected: [
      'wake',
      true,
      'supersede',
      { ...initial, disposed: true, generation: 1 },
    ],
  });
});
