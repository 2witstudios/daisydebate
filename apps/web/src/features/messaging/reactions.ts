import { createHash } from 'node:crypto';
import { createAppError } from '@daisy/errors';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { MessagingReactionStore } from '@daisy/db/messaging';
import {
  createMessagingReactionSchemas,
  type MessagingReactionPolicy,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';

type ReactionDependencies = {
  readonly policy: MessagingReactionPolicy;
  readonly store: MessagingReactionStore;
  readonly limit: (actorId: string, channelId: string) => Promise<void>;
};

/** Reaction intent never supplies actor authority or restores an earlier association on retry. */
export async function changeMessagingReaction(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: ReactionDependencies,
) {
  const actor = requireMessagingActor(principal);
  const schemas = createMessagingReactionSchemas(dependencies.policy);
  const command = parseValidated(schemas.command, input);
  await dependencies.limit(actor.actorId, command.channelId);
  const payloadDigest = createHash('sha3-256')
    .update(
      JSON.stringify([
        'reaction',
        command.version,
        command.channelId,
        command.messageId,
        command.reaction,
        command.active,
      ]),
    )
    .digest('hex');
  const result = schemas.result.safeParse(
    await dependencies.store.change(
      { ...actor, channelId: command.channelId },
      command,
      payloadDigest,
    ),
  );
  if (
    !result.success ||
    result.data.channelId !== command.channelId ||
    result.data.messageId !== command.messageId
  )
    throw createAppError('INFRASTRUCTURE');
  return result.data;
}

/** Reading a summary never grants association mutation or returns participant identities. */
export async function readMessagingReactions(
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: ReactionDependencies,
) {
  const actor = requireMessagingActor(principal);
  const schemas = createMessagingReactionSchemas(dependencies.policy);
  const scope = parseValidated(schemas.scope, input);
  await dependencies.limit(actor.actorId, scope.channelId);
  const result = schemas.result.safeParse(
    await dependencies.store.read(
      { ...actor, channelId: scope.channelId },
      scope.messageId,
    ),
  );
  if (
    !result.success ||
    result.data.channelId !== scope.channelId ||
    result.data.messageId !== scope.messageId
  )
    throw createAppError('INFRASTRUCTURE');
  return { ...result.data, policy: dependencies.policy };
}
