import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  accountHoldsCasualCapture,
  holdsRecordingDownload,
} from './download-entitlement';

setupRitewayBun();

const beta = [{ entitlement: 'recording_download', source: 'beta' }] as const;
const holds = (
  grants: readonly (typeof beta)[number][],
  betaGrantsPremium: boolean,
) =>
  holdsRecordingDownload({
    readGrants: async () => grants,
    betaGrantsPremium,
    now: () => '2026-11-05T00:00:00.000Z',
  })('user');

describe('holdsRecordingDownload', () => {
  test('follows the WATCH-8 entitlement', async () => {
    assert({
      given: 'a beta grant during the beta',
      should: 'allow a download',
      actual: await holds(beta, true),
      expected: true,
    });
    assert({
      given: 'a beta grant once beta no longer grants premium',
      should: 'refuse',
      actual: await holds(beta, false),
      expected: false,
    });
    assert({
      given: 'no grant',
      should: 'refuse: an absent entitlement is never a grant',
      actual: await holds([], true),
      expected: false,
    });
  });
});

describe('accountHoldsCasualCapture', () => {
  test('follows the casual capture grant and no other', async () => {
    const deps = (grants: readonly { entitlement: string; source: 'beta' }[]) =>
      accountHoldsCasualCapture({
        readGrants: async () => grants as never,
        betaGrantsPremium: true,
        now: () => '2026-11-05T00:00:00.000Z',
      })('user');
    assert({
      given: 'a capture grant, a download grant alone, and no grant',
      should: 'hold only on the capture grant',
      actual: [
        await deps([{ entitlement: 'casual_capture', source: 'beta' }]),
        await deps(beta),
        await deps([]),
      ],
      expected: [true, false, false],
    });
  });
});
