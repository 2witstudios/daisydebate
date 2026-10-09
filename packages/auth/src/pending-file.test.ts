import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type AuthorizationInput } from './authorization';
import { adultAccount } from './social.test-support';
setupRitewayBun();
test('pending file cleanup stays own-generation scoped after posting revocation', () => {
  const actorId = 'a'.repeat(24),
    channelId = 'b'.repeat(24);
  const resource = {
    kind: 'pending_file' as const,
    fileId: 'c'.repeat(24),
    channelId,
    ownerActorId: actorId,
    lifecycle: 'reserved' as const,
    generation: 1,
    expectedGeneration: 1,
    revision: 1,
    channel: {
      channelId,
      kind: 'dm' as const,
      policyKey: 'social.dm' as const,
      policyRevision: 1,
      revision: 1,
    },
  };
  const input = {
    principal: { kind: 'user' as const, userId: actorId, actorId },
    capability: 'channel.file.cleanup' as AuthorizationInput['capability'],
    resource,
    context: { account: adultAccount(actorId).account },
  };
  assert({
    given:
      'own pending generation without posting, age, reading or current grant evidence',
    should:
      'allow only reserved/quarantined cleanup and refuse foreign, stale, attached or invalid context',
    actual: [
      authorize(input).allow,
      authorize({
        ...input,
        resource: { ...resource, lifecycle: 'quarantined' },
      }).allow,
      authorize({
        ...input,
        resource: { ...resource, ownerActorId: 'd'.repeat(24) },
      }).allow,
      authorize({ ...input, resource: { ...resource, expectedGeneration: 2 } })
        .allow,
      authorize({ ...input, resource: { ...resource, lifecycle: 'attached' } })
        .allow,
      authorize({
        ...input,
        resource: { ...resource, channelId: 'd'.repeat(24) },
      }).allow,
      authorize({
        ...input,
        resource: {
          ...resource,
          channel: { ...resource.channel, policyKey: 'social.private_group' },
        },
      }).allow,
      authorize({
        ...input,
        context: { account: { ...input.context.account, erased: true } },
      }).allow,
      authorize({ ...input, capability: 'channel.read' }).allow,
      authorize({ ...input, capability: 'channel.post' }).allow,
    ],
    expected: [
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ],
  });
});
