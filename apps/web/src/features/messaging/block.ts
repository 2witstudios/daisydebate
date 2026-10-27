import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { ContactStore } from '@daisy/db/contacts';
import { createAppError } from '@daisy/errors';
import {
  parseSocialCommand,
  type SocialOperationDependencies,
} from './social-command';

import { messagingSocialDigest } from './social-command-digest';
import { requireMemberActor } from '../access/actor';

export async function blockMessagingContact(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: SocialOperationDependencies<ContactStore>,
) {
  const { actorId, userId } = requireMemberActor(principal);
  const command = parseSocialCommand(
    dependencies.bounds,
    input,
    (schemas) => schemas.block,
  );
  if (command.otherActorId === actorId) throw createAppError('VALIDATION');
  const digest = messagingSocialDigest('contact.block', [
    command.otherActorId,
    command.blocked,
  ]);
  return dependencies.store.withContacts(
    {
      actorId,
      userId,
      memberActorIds: [actorId, command.otherActorId],
    },
    async (frame) => {
      const receipt = await frame.readReceipt(command.requestId);
      if (receipt) {
        if (receipt.kind !== 'contact.block' || receipt.digest !== digest)
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
