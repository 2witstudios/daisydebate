import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { requireMemberActor } from '../access/actor';
import {
  usernameDiscoveryBatch,
  type DiscoverActor,
} from '../account/username-discovery';

/** Username discovery produces proposed IDs only; the existing transaction still authorizes creation. */
export async function resolveMessagingCreationIntent(
  kind: 'dm' | 'private_group',
  input: unknown,
  principal: AuthorizationPrincipal,
  dependencies: {
    readonly bounds: MessagingSocialBounds;
    readonly discover: DiscoverActor;
  },
) {
  const { actorId } = requireMemberActor(principal);
  const schemas = createMessagingSocialSchemas(dependencies.bounds);
  const command =
    kind === 'dm'
      ? parseValidated(schemas.requestUsername, input)
      : parseValidated(schemas.createGroupUsernames, input);
  const names =
    'recipientUsername' in command
      ? [command.recipientUsername]
      : command.invitedUsernames;
  // A batch discovery could never fit is refused before spending any of it.
  if (names.length > usernameDiscoveryBatch) throw createAppError('VALIDATION');
  const actors: string[] = [];
  for (const name of names) {
    const found = await dependencies.discover(actorId, name);
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
