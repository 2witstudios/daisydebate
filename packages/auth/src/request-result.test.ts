import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  authorize,
  type AuthorizationInput,
  type ChannelAuthorizationFact,
} from './authorization';
import { input, resource, policy } from './channel.test-support';
setupRitewayBun();
test('closed request receipts require distinct current result authority', () => {
  const result = {
    ...input,
    capability: 'channel.request.result' as AuthorizationInput['capability'],
  };
  assert({
    given: 'closed accepted, declined and cancelled requests',
    should: 'allow protected minimal result reads for the current pair',
    actual: (['accepted', 'declined', 'cancelled'] as const).map(
      (state) =>
        authorize({
          ...result,
          resource: {
            ...resource,
            authority: {
              ...resource.authority,
              kind: 'dm',
              lowActorId: 'a',
              highActorId: 'b',
              requestSenderActorId: 'a',
              state,
              blocked: true,
              revision: 3,
            },
            lifecycle: 'archived',
          },
        }).allow,
    ),
    expected: [true, true, true],
  });
  const pending: ChannelAuthorizationFact = {
    ...resource,
    authority: {
      kind: 'dm',
      lowActorId: 'a',
      highActorId: 'b',
      requestSenderActorId: 'a',
      state: 'pending',
      blocked: false,
      revision: 3,
    },
  };
  assert({
    given:
      'pending state, missing reading evidence, stale relationship or foreign principal',
    should: 'refuse without granting ordinary reads, writes or decisions',
    actual: [
      authorize({ ...result, resource: pending }).allow,
      authorize({ ...result, context: { account: input.context.account } })
        .allow,
      authorize({
        ...result,
        context: {
          ...input.context,
          socialReading: { ...policy, relationshipRevision: 2 },
        },
      }).allow,
      authorize({
        ...result,
        principal: { kind: 'user', userId: 'foreign', actorId: 'foreign' },
      }).allow,
      authorize({ ...input, resource: pending, capability: 'channel.read' })
        .allow,
      authorize({ ...input, resource: pending, capability: 'channel.post' })
        .allow,
      authorize({ ...result, capability: 'channel.request.decide' }).allow,
    ],
    expected: [false, false, false, false, false, false, false],
  });
});
