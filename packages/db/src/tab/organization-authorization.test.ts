import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { GrantRow } from './grant-rows';
import { grantAuthorityOf } from './organization-authorization';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const grant: GrantRow = {
  id: id('g'),
  userId: id('u'),
  scopeKind: 'organization',
  organizationId: id('o'),
  lobbyId: null,
  grantedAt: '2027-03-06T08:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  scopeOrganizationId: id('o'),
  role: {
    id: id('r'),
    organizationId: id('d'),
    name: 'Staff',
    rank: 2,
    preset: true,
    permissions: ['lobby.announce'],
  },
};
const holder = {
  membershipActive: false,
  staffMinimumBand: 'adult' as const,
  revision: 3,
};

describe('grantAuthorityOf', () => {
  test('an organization grant', () => {
    assert({
      given: 'a grant at an organization whose membership has ended',
      should: 'carry the seniority, the band and the ended membership',
      actual: grantAuthorityOf(grant, holder),
      expected: {
        grantId: id('g'),
        scope: { kind: 'organization', organizationId: id('o') },
        permissions: ['lobby.announce'],
        roleRank: -2,
        expiresAt: null,
        membershipActive: false,
        staffMinimumBand: 'adult',
        revision: 3,
      },
    });
  });
  test('a lobby grant', () => {
    const lobbyGrant = grantAuthorityOf(
      { ...grant, scopeKind: 'lobby', organizationId: null, lobbyId: id('l') },
      holder,
    );
    assert({
      given: 'a grant at a lobby, which rests on no membership',
      should: 'scope it to the lobby and count it as standing',
      actual: [lobbyGrant.scope, lobbyGrant.membershipActive],
      expected: [{ kind: 'lobby', lobbyId: id('l') }, true],
    });
  });
});
