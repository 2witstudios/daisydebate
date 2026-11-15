import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ask, leagueTournament, organizationGrant } from './lobby.test-support';
setupRitewayBun();
const resource = {
  kind: 'tournament_sponsorship',
  scope: leagueTournament,
  sponsorActorId: 'person',
} as const;
test('sponsorship consent is the named adult account’s authority, independent of organization staff', () => {
  assert({
    given:
      'the named adult, its teen, an unrelated adult and the organization owner or staff',
    should:
      'permit only current adult self-consent, never infer consent from organization authority',
    actual: [
      ask('tournament.sponsorship.consent', resource).allow,
      ask('tournament.sponsorship.consent', resource, {
        account: { ageBand: '16-17' },
      }).allow,
      ask('tournament.sponsorship.consent', resource, { actorId: 'other' })
        .allow,
      ask('tournament.sponsorship.consent', resource, {
        actorId: 'league-owner',
      }).allow,
      ask('tournament.sponsorship.consent', resource, {
        actorId: 'staff',
        grants: [organizationGrant('league', ['lobby.setup.manage'])],
      }).allow,
      ask('tournament.sponsorship.consent', resource, {
        account: { restricted: true },
      }).allow,
      ask('tournament.sponsorship.withdraw', resource, {
        account: { restricted: true },
      }).allow,
    ],
    expected: [true, false, false, false, false, false, true],
  });
});
