import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { holdsRecordingDownload } from './download-entitlement';

setupRitewayBun();

const beta = [{ entitlement: 'casual_capture', source: 'beta' }] as const;
const holds = (
  grants: readonly (typeof beta)[number][],
  betaGrantsPremium: boolean,
) =>
  holdsRecordingDownload({
    readGrants: async () => grants,
    betaGrantsPremium,
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
