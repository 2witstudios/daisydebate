import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leagueRequestOwnerAddress } from './owner-address';
setupRitewayBun();

test('leagueRequestOwnerAddress', () => {
  assert({
    given: 'both addresses set',
    should: "use League requests' own",
    actual: leagueRequestOwnerAddress({
      LEAGUE_REQUEST_NOTIFY_EMAIL: 'leagues@daisy.example',
      BETA_NOTIFY_EMAIL: 'owner@daisy.example',
    }),
    expected: 'leagues@daisy.example',
  });
  assert({
    given: 'only the beta owner address',
    should: 'fall back to it',
    actual: leagueRequestOwnerAddress({
      BETA_NOTIFY_EMAIL: 'owner@daisy.example',
    }),
    expected: 'owner@daisy.example',
  });
  assert({
    given: 'neither',
    should: 'have no address',
    actual: leagueRequestOwnerAddress({}),
    expected: undefined,
  });
});
