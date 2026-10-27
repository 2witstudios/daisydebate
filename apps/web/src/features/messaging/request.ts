import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { IdGenerator } from '@daisy/clock';
import type { SocialRequestLimits } from '@daisy/db';
import type { MessagingSocialStore } from '@daisy/db/messaging';
import { createAppError, isAppError } from '@daisy/errors';
import {
  parseSocialCommand,
  type SocialOperationDependencies,
} from './social-command';
import { requireMessagingActor } from './principal';
import { messagingSocialDigest } from './social-command-digest';

/**
 * A DM request by actor ID. An unknown recipient, a block, a decline block
 * and an inactive channel all answer the same NOT_FOUND before any budget is
 * spent, so a refusal never says which it was (DEC-251, as ADR 0072 does for
 * friends). The requester's own fence refusal (a waitlisted account) is
 * deliberately folded in too: telling it apart would need the fence to say
 * which side refused. An existing pending or accepted DM converges, with
 * nothing spent.
 */
export async function requestMessagingDm(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: SocialOperationDependencies<MessagingSocialStore> & {
    readonly ids: IdGenerator;
    readonly policyRevision: number;
    readonly limits: SocialRequestLimits;
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
  return dependencies.store
    .withContacts(
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
        // As send and block do: a replay never spends the limiter; a new
        // command spends it after the refusals that need no budget.
        const now = dependencies.clock.now();
        // An existing pending or accepted DM is no new request: it converges
        // without spending any limiter.
        const converged = await frame.screenDmRequest(now);
        if (converged) return converged;
        await dependencies.limit(actorId);
        return frame.commitDmRequest({
          requestId: command.requestId,
          channelId: dependencies.ids.next(),
          introduction: command.introduction ?? null,
          digest,
          now,
          policyRevision: dependencies.policyRevision,
          limits: dependencies.limits,
        });
      },
    )
    .catch((error: unknown) => {
      throw isAppError(error) && error.code === 'AUTHORIZATION'
        ? createAppError('NOT_FOUND')
        : error;
    });
}
