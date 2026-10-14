import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createObservationAuthorityDecision } from './observation';
import { account, actor, context, peer } from './observation.test-support';
setupRitewayBun();

test('an inbox observation is the actor-only partition of its own collection', () => {
  const decide = createObservationAuthorityDecision({});
  const inbox = {
    ...context,
    resource: { kind: 'inbox', id: actor },
    resourceFact: { kind: 'messaging_collection', actorId: actor },
  } as const;
  assert({
    given:
      'the owner, another actor’s inbox id, and an owner who is no longer a member',
    should: 'allow only the owner a private actor partition',
    actual: [
      decide(inbox),
      decide({ ...inbox, resource: { kind: 'inbox', id: peer } }).status,
      decide({ ...inbox, account: { ...account(actor), member: false } })
        .status,
    ],
    expected: [
      {
        status: 'allowed',
        partition: { kind: 'actor', actorId: actor },
        dependencies: [
          {
            key: `account-${actor}`,
            scope: 'subject',
            revision: '1',
            nextBoundary: null,
          },
        ],
        eligibleUntil: null,
        overlay: null,
      },
      'denied',
      'denied',
    ],
  });
});
