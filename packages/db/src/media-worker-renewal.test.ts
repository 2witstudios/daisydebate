import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireCaptureRenewal } from './media-worker-lease';
setupRitewayBun();

const current = { workerId: 'worker', epoch: 2, expiresAt: new Date(1000) };
for (const [label, lease, request, now] of [
  ['absent', undefined, { workerId: 'worker', expectedEpoch: 2 }, 0],
  ['foreign', current, { workerId: 'other', expectedEpoch: 2 }, 0],
  ['rotated', current, { workerId: 'worker', expectedEpoch: 1 }, 0],
  ['expired', current, { workerId: 'worker', expectedEpoch: 2 }, 1000],
] as const) {
  test(`capture renewal refuses ${label} authority`, async () => {
    await assertRejects({
      given: `${label} capture authority`,
      should: 'refuse renewal before any lease write',
      code: 'CONFLICT',
      actual: async () => requireCaptureRenewal(lease, request, new Date(now)),
    });
  });
}

test('initial claims and exact live renewals remain admissible', () => {
  assert({
    given: 'an initial claim or live exact renewal',
    should: 'allow the claim transaction to continue',
    actual: [
      requireCaptureRenewal(undefined, { workerId: 'worker' }, new Date(0)),
      requireCaptureRenewal(
        current,
        { workerId: 'worker', expectedEpoch: 2 },
        new Date(999),
      ),
    ],
    expected: [undefined, undefined],
  });
});
