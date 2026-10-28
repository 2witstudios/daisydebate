import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  captureLeaseRefusals,
  mediaWorkerLeaseEpoch,
} from './media-worker-lease';
setupRitewayBun();

const refusals = captureLeaseRefusals;
const current = { workerId: 'worker', epoch: 2, expiresAt: new Date(1000) };
for (const [label, lease, request, now, message] of [
  [
    'absent',
    undefined,
    { workerId: 'worker', expectedEpoch: 2 },
    0,
    refusals.stale,
  ],
  [
    'foreign',
    current,
    { workerId: 'other', expectedEpoch: 2 },
    0,
    refusals.held,
  ],
  [
    'rotated',
    current,
    { workerId: 'worker', expectedEpoch: 1 },
    0,
    refusals.stale,
  ],
  [
    'expired',
    current,
    { workerId: 'worker', expectedEpoch: 2 },
    1000,
    refusals.stale,
  ],
] as const) {
  test(`a media worker renewal refuses ${label} authority`, async () => {
    await assertRejects({
      given: `${label} lease authority`,
      should: `refuse before any lease write (${message})`,
      code: 'CONFLICT',
      actual: async () =>
        mediaWorkerLeaseEpoch(lease, request, new Date(now), refusals),
    });
  });
}

test('one claim rule decides every media worker lease epoch (ISSUE-764)', () => {
  assert({
    given:
      'a first claim, a live exact renewal, a live re-claim by the holder and a claim after expiry',
    should: 'take epoch 1, keep the live epoch twice, then move it on',
    actual: [
      mediaWorkerLeaseEpoch(
        undefined,
        { workerId: 'worker' },
        new Date(0),
        refusals,
      ),
      mediaWorkerLeaseEpoch(
        current,
        { workerId: 'worker', expectedEpoch: 2 },
        new Date(999),
        refusals,
      ),
      mediaWorkerLeaseEpoch(
        current,
        { workerId: 'worker' },
        new Date(999),
        refusals,
      ),
      mediaWorkerLeaseEpoch(
        current,
        { workerId: 'other' },
        new Date(1000),
        refusals,
      ),
    ],
    expected: [1, 2, 2, 3],
  });
});
