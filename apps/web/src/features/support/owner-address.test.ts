import { assert, setupRitewayBun, test } from 'riteway/bun';
import { supportOwnerAddress } from './owner-address';
setupRitewayBun();

test('supportOwnerAddress', () => {
  assert({
    given: 'both addresses set',
    should: "use support's own",
    actual: supportOwnerAddress({
      SUPPORT_NOTIFY_EMAIL: 'support@daisy.example',
      BETA_NOTIFY_EMAIL: 'owner@daisy.example',
    }),
    expected: 'support@daisy.example',
  });
  assert({
    given: 'only the beta owner address',
    should: 'fall back to it',
    actual: supportOwnerAddress({ BETA_NOTIFY_EMAIL: 'owner@daisy.example' }),
    expected: 'owner@daisy.example',
  });
  assert({
    given: 'neither',
    should: 'have no address',
    actual: supportOwnerAddress({}),
    expected: undefined,
  });
});
