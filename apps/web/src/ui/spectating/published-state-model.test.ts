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
