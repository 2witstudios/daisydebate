import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clearLease,
  observeLeaseLapse,
  type LeaseLapseState,
  type LeaseLapseVerdict,
} from './lease-lapse';
setupRitewayBun();

/** Every verdict for lapses observed at these monotonic instants. */
const verdictsAt = (instants: readonly number[]) => {
  let state: LeaseLapseState = clearLease;
  const verdicts: LeaseLapseVerdict[] = [];
  for (const at of instants) {
    const next = observeLeaseLapse(state, at);
    state = next.state;
    verdicts.push(next.verdict);
  }
  return verdicts;
};

const persisted = (instants: readonly number[]) =>
  verdictsAt(instants).flatMap((verdict, i) =>
    verdict === 'persisted' ? [instants[i]] : [],
  );

test('a lapse persists once its lapses have kept arriving for ten seconds', () => {
  const everyHalfSecond = Array.from({ length: 60 }, (_, i) => i * 500);
  assert({
    given: 'a lapse observed every 500 ms for thirty seconds',
    should: 'report once, on the lapse ten seconds after the first',
    actual: persisted(everyHalfSecond),
    expected: [10_000],
  });
});

test('a burst inside one second, however many failures it holds, never persists', () => {
  assert({
    given: 'a thousand lapses inside one second',
    should: 'stay transient',
    actual: persisted(Array.from({ length: 1000 }, (_, i) => i)),
    expected: [],
  });
});

test('isolated blips apart by more than the quiet gap never add up', () => {
  assert({
    given: 'a one-second blip every 31 seconds for ten minutes',
    should: 'stay transient, since each blip starts a new streak',
    actual: persisted(
      Array.from({ length: 20 }, (_, i) => [
        i * 31_000,
        i * 31_000 + 900,
      ]).flat(),
    ),
    expected: [],
  });
});

test('a lapse that returns after a quiet gap can report again', () => {
  const streak = (start: number) =>
    Array.from({ length: 25 }, (_, i) => start + i * 500);
  assert({
    given:
      'two twelve-second lapses with a forty-second quiet gap between them',
    should: 'report each once',
    actual: persisted([...streak(0), ...streak(52_000)]),
    expected: [10_000, 62_000],
  });
});
