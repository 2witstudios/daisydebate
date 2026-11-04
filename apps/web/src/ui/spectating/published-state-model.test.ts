import type { AudienceState } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  firstPublishedReads,
  nextPublishedReads,
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
