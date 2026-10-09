import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { IdGenerator } from '@daisy/clock';
import type { MessagingGroupCreationStore } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import { createMessagingSocialSchemas } from '@daisy/protocol';
import { requireMessagingActor } from './principal';
import {
  parseSocialCommand,
  type SocialOperationDependencies,
} from './social-command';
import { messagingSocialDigest } from './social-command-digest';
export async function createMessagingGroup(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: SocialOperationDependencies<MessagingGroupCreationStore> & {
    readonly ids: IdGenerator;
    readonly policyRevision?: number;
  },
) {
  const actor = requireMessagingActor(principal);
  const command = parseSocialCommand(
    dependencies.bounds,
    input,
    (schemas) => schemas.createGroup,
  );
  if (command.invitedActorIds.includes(actor.actorId))
    throw createAppError('VALIDATION');
  const invitees = [...command.invitedActorIds].sort();
  const digest = messagingSocialDigest('group.create', [
    command.title,
    invitees,
  ]);
  return dependencies.store.withCreation(
    {
      ...actor,
      requestId: command.requestId,
      proposedActorIds: [actor.actorId, ...invitees],
      ...(dependencies.policyRevision === undefined
        ? {}
        : { policyRevision: dependencies.policyRevision }),
    },
    async (frame) => {
      const receipt = await frame.readResult();
      if (receipt) {
        if (receipt.kind !== 'group.create' || receipt.digest !== digest)
          throw createAppError('CONFLICT');
        return { channelId: receipt.channelId, lifecycle: receipt.lifecycle };
      }
      await frame.authorize();
      await dependencies.limit(actor.actorId);
      await frame.authorize();
      const now = dependencies.clock.now();
      if (!Number.isFinite(Date.parse(now))) throw createAppError('VALIDATION');
      const channelId = dependencies.ids.next();
      const result = await frame.commit({
        channelId,
        title: command.title,
        digest,
        now,
      });
      const parsed = createMessagingSocialSchemas(
        dependencies.bounds,
      ).groupResult.safeParse({ ...result, version: 1 });
      if (!parsed.success || parsed.data.channelId !== channelId)
        throw createAppError('INFRASTRUCTURE');
      return {
        channelId: parsed.data.channelId,
        lifecycle: parsed.data.lifecycle,
      };
    },
  );
}
