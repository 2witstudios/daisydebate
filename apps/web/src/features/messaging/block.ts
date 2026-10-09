import { createHash } from 'node:crypto';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { MessagingSocialStore } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';

export async function blockMessagingContact(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly store: MessagingSocialStore;
    readonly bounds: MessagingSocialBounds;
    readonly clock: Clock;
    readonly limit: (actorId: string) => Promise<void>;
  },
) {
  const { actorId, userId } = requireMessagingActor(principal);
  const command = parseValidated(
    createMessagingSocialSchemas(dependencies.bounds).block,
    input,
  );
  if (command.otherActorId === actorId) throw createAppError('VALIDATION');
  const digest = createHash('sha3-256')
    .update(
      JSON.stringify([
        command.version,
        'dm.block',
        command.otherActorId,
        command.blocked,
      ]),
    )
    .digest('hex');
  return dependencies.store.withContacts(
    {
      actorId,
      userId,
      memberActorIds: [actorId, command.otherActorId],
    },
    async (frame) => {
      const receipt = await frame.readReceipt(command.requestId);
      if (receipt) {
        if (receipt.kind !== 'dm.block' || receipt.digest !== digest)
          throw createAppError('CONFLICT');
        return {
          blocked: frame.blocking!,
          revision: frame.contacts[0]!.revision,
        };
      }
      await dependencies.limit(actorId);
      return frame.commitBlock({
        requestId: command.requestId,
        blocked: command.blocked,
        digest,
        now: dependencies.clock.now(),
      });
    },
  );
}
