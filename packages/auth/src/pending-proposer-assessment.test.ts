import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  authorize,
  assessPendingProposer,
  type AuthorizationInput,
} from './authorization';
import { fixture, hosted, NOW } from './lobby.test-support';
setupRitewayBun();
const input = (): AuthorizationInput => ({
  principal: { kind: 'user', userId: 'host', actorId: 'host' },
  capability: 'tournament.results.enter',
  resource: fixture(hosted, {
    conflict: {
      connections: ['seated'],
      handling: 'second_confirms',
      waiverId: null,
    },
  }),
  context: {
    now: NOW,
    account: {
      userId: 'host',
      actorId: 'host',
      member: true,
      erased: false,
      revision: 1,
      beta: { state: 'approved', revision: 1 },
      ageBand: 'adult',
      restricted: false,
    },
    grants: [],
  },
});
test('pending proposer assessment is distinct from permission to execute a conflicted command', () => {
  const held = input();
  const denied = {
    ...held,
    resource: fixture(hosted, {
      conflict: { connections: ['seated'], handling: 'denied', waiverId: null },
    }),
  };
  assert({
    given:
      'a current entitled proposer who requires a second confirmer, a denied policy and a revoked account',
    should:
      'retain current authority for confirmation assessment without granting ordinary execution or bypassing denied/revoked policy',
    actual: [
      authorize(held).allow,
      assessPendingProposer(held).kind,
      assessPendingProposer(denied).kind,
      assessPendingProposer({
        ...held,
        context: {
          ...held.context,
          account: { ...held.context.account!, restricted: true },
        },
      }).kind,
    ],
    expected: [false, 'eligible', 'refused', 'refused'],
  });
});
