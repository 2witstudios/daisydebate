import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotActivityRelay } from './activity-relay';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const seat = id('p'),
  segment = id('g'),
  nextSegment = id('h');
const now = '2026-10-22T12:00:01.000Z';
const frame = {
  trackId: 'track',
  sequence: 1,
  pcm: Array<number>(160).fill(1),
  beforeMs: 0,
  afterMs: 10,
  serverWindow: {
    before: '2026-10-22T12:00:00.980Z',
    after: '2026-10-22T12:00:00.990Z',
  },
};
const body = (segmentId = segment) => ({
  version: 1,
  roundParticipantId: seat,
  segmentId,
  frames: [frame],
});
function harness() {
  const calls = { capture: 0, lease: 0, writes: 0 };
  let leaseCurrent = true;
  const relay = createBotActivityRelay({
    readCapture: async () => {
      calls.capture++;
      return {
        serverNow: now,
        segment: { id: segment, endedAt: null },
        participants: [{ roundParticipantId: seat, identity: 'i' }],
      };
    },
    readLease: async () => {
      calls.lease++;
      if (!leaseCurrent)
        throw createAppError('CONFLICT', 'Capture worker lease is stale');
      return { serverNow: now };
    },
    write: async () => {
      calls.writes++;
    },
  });
  return {
    relay,
    calls,
    expire: () => {
      leaseCurrent = false;
    },
  };
}
const identity = { roundId: id('r'), sessionId: id('s'), workerId: id('w') };
test('a seat is admitted once per lease epoch and segment; later batches take no locked read', async () => {
  const f = harness();
  for (let i = 0; i < 3; i++) await f.relay({ ...identity, epoch: 1 }, body());
  const admitted = { ...f.calls };
  await f.relay({ ...identity, epoch: 2 }, body());
  await assertRejects({
    given: 'a batch naming a segment that is not the current one',
    should: 'refuse admission',
    actual: () => f.relay({ ...identity, epoch: 2 }, body(nextSegment)),
    code: 'CONFLICT',
  });
  assert({
    given: 'three batches in one epoch and segment, then a new epoch',
    should:
      'take one locked capture read per admission, and the same lease check on every batch',
    actual: [admitted, f.calls],
    expected: [
      { capture: 1, lease: 3, writes: 3 },
      { capture: 3, lease: 4, writes: 4 },
    ],
  });
  f.expire();
  await assertRejects({
    given: 'an admitted seat whose lease is no longer current',
    should: 'refuse the batch without writing',
    actual: () => f.relay({ ...identity, epoch: 2 }, body()),
    code: 'CONFLICT',
  });
  assert({
    given: 'that refusal',
    should: 'write nothing',
    actual: f.calls.writes,
    expected: 4,
  });
});
