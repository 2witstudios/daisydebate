import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { ContactStore } from '@daisy/db/contacts';
import { createAppError } from '@daisy/errors';
import {
  contactBlockSchema,
  contactBlockUsernameSchema,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMemberActor } from '../access/actor';
import { contactCommandDigest } from './digest';
import type { DiscoverActor } from '../account/username-discovery';

export type ContactBlockDependencies = {
  readonly store: ContactStore;
  readonly clock: Clock;
  readonly limit: (actorId: string) => Promise<void>;
};

/**
 * A member blocks or unblocks another (ADR 0072): a request ID replays its
 * result, a different choice under it conflicts, and a fresh one spends
 * Contacts' block budget before the pair is changed.
 */
export async function blockContact(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: ContactBlockDependencies,
) {
  const { actorId, userId } = requireMemberActor(principal);
  const command = parseValidated(contactBlockSchema, input);
  if (command.otherActorId === actorId) throw createAppError('VALIDATION');
  const digest = contactCommandDigest('contact.block', [
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

/**
 * A block by username: the name is resolved through the one username port
 * (which spends discovery first), an unknown name refuses like any other
 * unauthorized pair, and the proposed actor goes through the same fenced
 * block.
 */
export async function blockContactByUsername(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: ContactBlockDependencies & {
    readonly discover: DiscoverActor;
  },
) {
  const { actorId } = requireMemberActor(principal);
  const command = parseValidated(contactBlockUsernameSchema, input);
  const otherActorId = await dependencies.discover(actorId, command.username);
  if (otherActorId === null) throw createAppError('AUTHORIZATION');
  return blockContact(
    {
      version: command.version,
      requestId: command.requestId,
      otherActorId,
      blocked: command.blocked,
    },
    principal,
    dependencies,
  );
}
