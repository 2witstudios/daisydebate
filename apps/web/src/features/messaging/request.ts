import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { IdGenerator } from '@daisy/clock';
import type { MessagingSocialStore } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  parseSocialCommand,
  type SocialOperationDependencies,
} from './social-command';
import { requireMessagingActor } from './principal';
import { messagingSocialDigest } from './social-command-digest';

export async function requestMessagingDm(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: SocialOperationDependencies<MessagingSocialStore> & {
    readonly ids: IdGenerator;
    readonly policyRevision: number;
    readonly limits: {
      readonly windowMs: number;
      readonly maxNewPairs: number;
      readonly maxPending: number;
      readonly cooldownMs: number;
    };
  },
) {
  const { actorId, userId } = requireMessagingActor(principal);
  const command = parseSocialCommand(
    dependencies.bounds,
    input,
    (schemas) => schemas.requestDm,
  );
  if (command.recipientActorId === actorId) throw createAppError('VALIDATION');
  const digest = messagingSocialDigest('dm.request', [
    command.recipientActorId,
    command.introduction ?? null,
  ]);
  return dependencies.store.withContacts(
    {
      actorId,
      userId,
      memberActorIds: [actorId, command.recipientActorId],
      policyRevision: dependencies.policyRevision,
    },
    async (frame) => {
      const receipt = await frame.readReceipt(command.requestId);
      if (receipt) {
        const current = await frame.readDmRequest();
        if (!current || current.channelId !== receipt.channelId)
          throw createAppError('NOT_FOUND');
        if (receipt.kind !== 'dm.request' || receipt.digest !== digest)
          throw createAppError('CONFLICT');
        return current;
      }
      await dependencies.limit(actorId);
      return frame.commitDmRequest({
        requestId: command.requestId,
        channelId: dependencies.ids.next(),
        introduction: command.introduction ?? null,
        digest,
        now: dependencies.clock.now(),
        policyRevision: dependencies.policyRevision,
        limits: dependencies.limits,
      });
    },
  );
}
