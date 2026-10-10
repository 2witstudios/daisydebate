import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMessagingActor } from './principal';
/** Username discovery produces proposed IDs only; the existing transaction still authorizes creation. */
export async function resolveMessagingCreationIntent(
  kind: 'dm' | 'private_group',
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly bounds: MessagingSocialBounds;
    readonly lookup: (username: string) => Promise<string | null>;
    readonly limit: (actorId: string) => Promise<void>;
  },
) {
  const { actorId } = requireMessagingActor(principal);
  const schemas = createMessagingSocialSchemas(dependencies.bounds);
  const command =
    kind === 'dm'
      ? parseValidated(schemas.requestUsername, input)
      : parseValidated(schemas.createGroupUsernames, input);
  await dependencies.limit(actorId);
  const names =
    'recipientUsername' in command
      ? [command.recipientUsername]
      : command.invitedUsernames;
  const actors: string[] = [];
  for (const name of names) {
    const found = await dependencies.lookup(name);
    if (found === null) throw createAppError('AUTHORIZATION');
    actors.push(found);
  }
  const base = { version: 1 as const, requestId: command.requestId };
  return 'recipientUsername' in command
    ? {
        ...base,
        recipientActorId: actors[0],
        ...(command.introduction === undefined
          ? {}
          : { introduction: command.introduction }),
      }
    : { ...base, title: command.title, invitedActorIds: actors };
}
