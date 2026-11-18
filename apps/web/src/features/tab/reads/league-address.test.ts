import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leaguePageAddress } from './league-address';
setupRitewayBun();
test('league addresses keep actual standing and organization handles distinct', async () => {
  const store = {
    organizationIdOfHandle: async (handle: string) =>
      handle === 'organization-address' ? 'organization-id' : null,
    standingLobbyAddressOfHandle: async (handle: string) =>
      handle === 'standing-address'
        ? { organizationId: 'organization-id', lobbyId: 'standing-id' }
        : null,
  };
  assert({
    given: 'different actual organization and standing lobby handles',
    should: 'resolve only the explicit namespace',
    actual: await Promise.all([
      leaguePageAddress(store, {
        kind: 'standing',
        handle: 'standing-address',
      }),
      leaguePageAddress(store, {
        kind: 'organization',
        handle: 'organization-address',
      }),
      leaguePageAddress(store, {
        kind: 'standing',
        handle: 'organization-address',
      }),
      leaguePageAddress(store, {
        kind: 'organization',
        handle: 'standing-address',
      }),
    ]),
    expected: [
      { organizationId: 'organization-id', lobbyId: 'standing-id' },
      { organizationId: 'organization-id' },
      null,
      null,
    ],
  });
});
