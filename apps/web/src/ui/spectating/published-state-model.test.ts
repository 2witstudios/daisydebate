import type { AudienceState } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  nextPollDelayMs,
  POLL_MAX_MS,
  POLL_MS,
} from '../../features/spectating/poll-pace';
import {
  firstPublishedReads,
  nextPublishedReads,
  paceOfPublishedRead,
  serverAsksOf,
} from './published-state-model';

setupRitewayBun();

const stateAt = (publishedAtMs: number) =>
  ({ publishedAtMs }) as unknown as AudienceState;
const first = firstPublishedReads(0);

test('a tab keeps the latest state it has read', () => {
  const read = nextPublishedReads(
    first,
    { kind: 'state', state: stateAt(5) },
    10,
  );
  assert({
    given: 'an older object after a newer one',
    should: 'keep the newer and not count it as movement',
    actual: nextPublishedReads(read, { kind: 'state', state: stateAt(4) }, 20),
    expected: read,
  });
});

test('a failed read does not move the state', () => {
  const read = nextPublishedReads(
    first,
    { kind: 'state', state: stateAt(5) },
    10,
  );
  assert({
    given: 'a read with no answer',
    should: 'leave the moment it last moved, so staleness keeps growing',
    actual: nextPublishedReads(read, { kind: 'failed' }, 40_000).movedAtMs,
    expected: 10,
  });
});

test('a missing object means something only after a state', () => {
  const read = nextPublishedReads(
    first,
    { kind: 'state', state: stateAt(5) },
    10,
  );
  assert({
    given: 'a missing object before and after a state was read',
    should: 'wait before, and send the page back to the server after',
    actual: [
      nextPublishedReads(first, { kind: 'missing' }, 5).gone,
      nextPublishedReads(read, { kind: 'missing' }, 20).gone,
    ],
    expected: [false, true],
  });
});

test('a tab slows down while its address is gone, and recovers with it', () => {
  const answered = { kind: 'answered' } as const;
  const read = nextPublishedReads(
    first,
    { kind: 'state', state: stateAt(5) },
    10,
  );
  const gone = nextPublishedReads(read, { kind: 'missing' }, 20);
  const back = nextPublishedReads(
    gone,
    { kind: 'state', state: stateAt(6) },
    30,
  );
  const middle = () => 0.5;
  // Each read while gone is one more miss in the pace.
  const waits: number[] = [];
  let misses = 0;
  for (let reads = 0; reads < 6; reads += 1) {
    const next = nextPollDelayMs(
      misses,
      paceOfPublishedRead(gone, answered),
      middle,
    );
    misses = next.misses;
    waits.push(next.delayMs);
  }
  assert({
    given:
      'a bucket that answers every read, for an address not yet published, one that is gone, and one that came back',
    should:
      'keep the ordinary pace before and after, and double the wait up to the limit while it is gone',
    actual: {
      before: paceOfPublishedRead(first, answered),
      whileGone: waits,
      after: nextPollDelayMs(
        misses,
        paceOfPublishedRead(back, answered),
        middle,
      ).delayMs,
    },
    expected: {
      before: answered,
      whileGone: [4000, 8000, 16000, POLL_MAX_MS, POLL_MAX_MS, POLL_MAX_MS],
      after: POLL_MS,
    },
  });
});

test('the server is asked again, ever less often, while an address stays gone', () => {
  const read = nextPublishedReads(
    first,
    { kind: 'state', state: stateAt(5) },
    10,
  );
  const asks: number[] = [];
  let reads = read;
  for (let miss = 0; miss < 9; miss += 1) {
    reads = nextPublishedReads(reads, { kind: 'missing' }, 20 + miss);
    asks.push(serverAsksOf(reads));
  }
  const back = nextPublishedReads(
    reads,
    { kind: 'state', state: stateAt(6) },
    99,
  );
  const again = nextPublishedReads(back, { kind: 'missing' }, 100);
  assert({
    given:
      'nine missing reads in a row after a state, the state returning, then missing once more',
    should:
      'ask at the first, second, fourth and eighth, stop asking once it is back, and start over when it goes again',
    actual: {
      before: serverAsksOf(read),
      asks,
      back: serverAsksOf(back),
      again: serverAsksOf(again),
    },
    expected: {
      before: 0,
      asks: [1, 2, 2, 3, 3, 3, 3, 4, 4],
      back: 0,
      again: 1,
    },
  });
});

test('the same object readable again means the address is back', () => {
  const read = nextPublishedReads(
    first,
    { kind: 'state', state: stateAt(5) },
    10,
  );
  const gone = nextPublishedReads(read, { kind: 'missing' }, 20);
  assert({
    given:
      'a missing read, then the same object again with nothing newer published',
    should: 'no longer be gone, keeping the state and when it last moved',
    actual: nextPublishedReads(gone, { kind: 'state', state: stateAt(5) }, 30),
    expected: read,
  });
});

test('a refusal keeps the wait the bucket asked for, gone or not', () => {
  const refused = { kind: 'refused', retryAfterMs: 120_000 } as const;
  const gone = nextPublishedReads(
    nextPublishedReads(first, { kind: 'state', state: stateAt(5) }, 10),
    { kind: 'missing' },
    20,
  );
  assert({
    given: 'the bucket asking a tab on a gone address to wait two minutes',
    should: 'wait at least that long, not the 30 s a miss would allow',
    actual: nextPollDelayMs(0, paceOfPublishedRead(gone, refused), () => 0.5)
      .delayMs,
    expected: 120_000,
  });
});
