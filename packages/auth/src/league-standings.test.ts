import { assert, test, setupRitewayBun } from 'riteway/bun';
import { ask, organization, grant } from './lobby.test-support';

setupRitewayBun();
test('league standings require a current league connection', () => {
  const league = organization('league');
  const manage = grant({
    scope: { kind: 'organization', organizationId: 'league' },
    permissions: ['organization.manage'],
  });
  assert({
    given: 'a league member, manager, unrelated adult and school member',
    should: 'allow only the league member and manager',
    actual: [
      ask('standings.read', { ...league, member: true }).allow,
      ask('standings.read', league, { grants: [manage] }).allow,
      ask('standings.read', league).allow,
      ask('standings.read', {
        ...league,
        organizationKind: 'school',
        member: true,
      }).allow,
    ],
    expected: [true, true, false, false],
  });
  assert({
    given: 'a revoked or expired organization grant',
    should: 'refuse league standings',
    actual: ask('standings.read', league, {
      grants: [{ ...manage, expiresAt: '2026-11-12T00:00:00.000Z' }],
    }).allow,
    expected: false,
  });
});
