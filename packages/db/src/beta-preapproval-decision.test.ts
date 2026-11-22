import { assert, setupRitewayBun, test } from 'riteway/bun';
import { canInviteClaimedPreapproval } from './beta-preapproval-decision';
setupRitewayBun();

test('claimed invitation eligibility follows current verified identity and access', () => {
  const eligible = {
    verified: true,
    emailMatches: true,
    erased: false,
    restricted: false,
    state: 'approved',
    ageBand: 'adult',
  };
  assert({
    given:
      'an eligible claimed account and changed email, unverified email, a 13-15 account, an age corrected under 13 or gone, revocation, moderation or erasure',
    should: 'invite only the current matching eligible account',
    actual: [
      eligible,
      { ...eligible, emailMatches: false },
      { ...eligible, verified: false },
      { ...eligible, ageBand: '13-15' },
      { ...eligible, ageBand: 'under-13' },
      { ...eligible, ageBand: null },
      { ...eligible, state: 'revoked' },
      { ...eligible, restricted: true },
      { ...eligible, erased: true },
    ].map(canInviteClaimedPreapproval),
    expected: [true, false, false, true, false, false, false, false, false],
  });
});
