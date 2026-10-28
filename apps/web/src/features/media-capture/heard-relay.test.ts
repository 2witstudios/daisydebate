import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureHeardRelay } from './heard-relay';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const seat = id('p'),
  segment = id('g'),
  nextSegment = id('h');
const now = '2026-10-22T12:00:01.000Z';
const identity = { roundId: id('r'), sessionId: id('s'), workerId: id('w') };

function heardHarness(kind: 'human' | 'bot', identityBound = true) {
  const writes: unknown[] = [];
  let leaseCurrent = true;
  const relay = createCaptureHeardRelay({
    readCapture: async () => ({
      serverNow: now,
      segment: { id: segment, endedAt: null },
      participants: [
        {
          roundParticipantId: seat,
          kind,
          identity: identityBound ? 'i' : null,
        },
      ],
    }),
    readLease: async () => {
      if (!leaseCurrent)
        throw createAppError('CONFLICT', 'Capture worker lease is stale');
      return { serverNow: now };
    },
    write: async (heard) => {
      writes.push(heard);
    },
  });
  return {
    relay,
    writes,
    expire: () => {
      leaseCurrent = false;
    },
  };
}
const heard = (segmentId = segment) => ({
  version: 1,
  roundParticipantId: seat,
  segmentId,
  trackId: 'TR_bot',
});
test("capture's report that it hears a bound bot seat's track names that seat for the track (ISSUE-514-r2)", async () => {
  const f = heardHarness('bot');
  await f.relay({ ...identity, epoch: 1 }, heard());
  assert({
    given: 'a report for a bound bot seat in the current segment',
    should: 'write the seat for that Round and track',
    actual: f.writes,
    expected: [{ roundId: identity.roundId, trackId: 'TR_bot', seat }],
  });
});
test('a heard report is admitted only for a bound bot seat, the current segment and a current lease', async () => {
  for (const [given, f, body, code] of [
    ['a human seat', heardHarness('human'), heard(), 'AUTHORIZATION'],
    [
      'an unbound bot seat',
      heardHarness('bot', false),
      heard(),
      'AUTHORIZATION',
    ],
    [
      'a segment that is not current',
      heardHarness('bot'),
      heard(nextSegment),
      'CONFLICT',
    ],
    [
      'a malformed track',
      heardHarness('bot'),
      { ...heard(), trackId: 'no spaces' },
      'VALIDATION',
    ],
  ] as const)
    await assertRejects({
      given,
      should: 'refuse the report',
      actual: () => f.relay({ ...identity, epoch: 1 }, body),
      code,
    });
  const stale = heardHarness('bot');
  stale.expire();
  await assertRejects({
    given: 'a report under a lease that is no longer current',
    should: 'refuse it',
    actual: () => stale.relay({ ...identity, epoch: 1 }, heard()),
    code: 'CONFLICT',
  });
  assert({
    given: 'that refused report',
    should: 'write nothing',
    actual: stale.writes,
    expected: [],
  });
});
