import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  decideMediaRead,
  decideSupersededRead,
  MEDIA_READ_LET_FINISH_MS,
  type MediaReadEvent,
} from './media-read-intent';
setupRitewayBun();

const initial = {
  roundViewVersion: 3,
  deadlineMs: null,
  generation: 0,
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
test('old, duplicate and malformed events are inert', () => {
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
  assert({
    given: 'non-advancing or malformed keys',
    should: 'retain identical state without scheduling work',
    actual: events.every((event) => {
      const next = decideMediaRead(intent, event);
      return next.intent === intent && next.action === 'ignore';
    }),
    expected: true,
  });
});
test('wake keeps authority', () => {
  const wake = decideMediaRead(initial, { kind: 'wake' });
  assert({
    given: 'a same-intent wake',
    should: 'nudge without minting authority',
    actual: [wake.action, wake.intent === initial],
    expected: ['wake', true],
  });
});

test('only a young read in a burst is allowed to finish', () => {
  const decide = (supersededSinceAnswer: number, readAgeMs: number) =>
    decideSupersededRead({ supersededSinceAnswer, readAgeMs });
  assert({
    given: 'each combination of burst position and read age',
    should:
      'abort the first, abort an old read, and let only a young one finish',
    actual: [
      decide(0, 0),
      decide(0, MEDIA_READ_LET_FINISH_MS),
      decide(1, 0),
      decide(1, MEDIA_READ_LET_FINISH_MS - 1),
      decide(1, MEDIA_READ_LET_FINISH_MS),
      decide(9, Number.MAX_SAFE_INTEGER),
    ],
    expected: ['abort', 'abort', 'let-finish', 'let-finish', 'abort', 'abort'],
  });
});
