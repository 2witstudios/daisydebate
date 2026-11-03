import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { requireCaptureSession } from './media-capture-context';

setupRitewayBun();

const txReading = (rows: readonly object[]) =>
  ({
    select: () => ({ from: () => ({ where: async () => rows }) }),
  }) as unknown as Parameters<typeof requireCaptureSession>[0];

test('a session closed to writes is a pause its worker retries, never closed for good (ISSUE-494-r3)', async () => {
  await assertRejects({
    given: 'a write captured after its session was marked unsafe',
    should: 'refuse as capture-paused',
    actual: () =>
      requireCaptureSession(
        txReading([
          {
            endedAt: null,
            unsafeAt: new Date(0),
            deletionRequestedAt: null,
          },
        ]),
        { sessionId: 's'.repeat(24) },
        {
          capturedUntil: new Date(1_000),
          receivedAt: new Date(1_000),
          sttLagMs: 0,
        },
      ),
    code: 'CONFLICT',
    reason: 'capture-paused',
  });
});
