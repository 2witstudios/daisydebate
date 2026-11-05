import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entitlementKinds, type EntitlementGrant } from '@daisy/protocol';
import { hostHoldsCasualCapture } from '../room-runtime/capture-offer';
import { hostHoldsCasualAiJudge } from '../room-runtime/ai-judge-seating';
import { holdsRecordingDownload } from './download-entitlement';

setupRitewayBun();

const startsAt = '2026-11-01T00:00:00.000Z';
const expiresAt = '2026-12-01T00:00:00.000Z';
const grants: readonly EntitlementGrant[] = entitlementKinds.map(
  (entitlement) => ({
    entitlement,
    source: 'subscription',
    startsAt,
    expiresAt,
  }),
);

test('Watch capability reads expire unchanged subscription grants while workers are offline', async () => {
  const evaluate = async (now: string) => [
    hostHoldsCasualCapture(grants, false, now),
    hostHoldsCasualAiJudge(grants, false, now),
    await holdsRecordingDownload({
      readGrants: async () => grants,
      betaGrantsPremium: false,
      now: () => now,
    })('member'),
  ];
  assert({
    given:
      'identical durable grants just before and at their expiry, without a cleanup worker',
    should:
      'refuse capture, casual judge and download immediately at the boundary',
    actual: await Promise.all([
      evaluate('2026-11-30T23:59:59.999Z'),
      evaluate(expiresAt),
    ]),
    expected: [
      [true, true, true],
      [false, false, false],
    ],
  });
});

test('download validity samples time after the asynchronous grant read', async () => {
  let now = startsAt;
  const holds = holdsRecordingDownload({
    readGrants: async () => {
      now = expiresAt;
      return grants;
    },
    betaGrantsPremium: false,
    now: () => now,
  });
  assert({
    given: 'a grant read delayed beyond the subscription deadline',
    should: 'refuse using the current instant rather than the pre-read instant',
    actual: await holds('member'),
    expected: false,
  });
});
