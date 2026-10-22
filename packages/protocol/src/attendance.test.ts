import { assert, setupRitewayBun, test } from 'riteway/bun';
import { attendanceEnvelopeSchema } from './attendance';
setupRitewayBun();
const input = {
  version: 1,
  commandId: 'a'.repeat(24),
  segmentId: 'b'.repeat(24),
};
test('attendance envelope never accepts body identity or receipt timestamps', () => {
  for (const extra of [
    { actorId: 'c'.repeat(24) },
    { participantId: 'c'.repeat(24) },
    { serviceId: 'agent-run:x' },
    { receivedAt: '2026-10-22T00:00:00Z' },
  ])
    assert({
      given: JSON.stringify(extra),
      should: 'reject client authority or claimed receipt',
      actual: attendanceEnvelopeSchema.safeParse({ ...input, ...extra })
        .success,
      expected: false,
    });
  assert({
    given: 'versioned actual segment and command identities',
    should: 'accept the canonical strict envelope',
    actual: attendanceEnvelopeSchema.safeParse(input).success,
    expected: true,
  });
});
