import type { AuthorizationInput } from '@daisy/auth/authorization';
import type {
  LoadedEntryEnrollment,
  EntryEnrollmentCommand,
} from '@daisy/db/tab';
import type { TabPrincipal } from '../tab-principal';
import { CommandDenied } from '../commands/run-command';
import { hostLobbyResource } from './host-lobby-resource';

export const entryEnrollmentAuthority = (
  loaded: LoadedEntryEnrollment,
  principal: TabPrincipal,
  command: EntryEnrollmentCommand,
  now: string,
): Omit<AuthorizationInput, 'capability'> => {
  const lobby = hostLobbyResource(
    loaded.lobby,
    loaded.authorization.organization,
    loaded.ownerActorId,
  );
  if (lobby.kind !== 'lobby' || lobby.scope.lobbyKind !== 'tournament')
    throw new CommandDenied('not-found');
  if (
    command.type === 'accept-entry' ||
    command.type === 'decline-entry' ||
    command.type === 'set-entry-division'
  )
    return {
      principal,
      resource: lobby,
      context: {
        account: loaded.authorization.account,
        grants: loaded.authorization.grants,
        now,
      },
    };
  const kind =
    command.type === 'submit-entry'
      ? command.responsible.kind
      : loaded.entry?.responsibleKind;
  const school = loaded.schoolAuthorization?.organization;
  const actorId =
    command.type === 'submit-entry'
      ? command.memberActorIds.length === 1
        ? command.memberActorIds[0]
        : null
      : loaded.people.length === 1
        ? loaded.people[0]!.actorId
        : null;
  const responsible =
    kind === 'school' && school
      ? { kind: 'school' as const, school }
      : kind === 'guardian' && loaded.guardianActorId
        ? { kind: 'guardian' as const, guardianActorId: loaded.guardianActorId }
        : kind === 'self' && actorId
          ? { kind: 'self' as const, actorId }
          : null;
  if (!responsible) throw new CommandDenied('not-found');
  return {
    principal,
    resource: { kind: 'entry', scope: lobby.scope, responsible },
    context: {
      account: loaded.authorization.account,
      grants: [
        ...loaded.authorization.grants,
        ...(loaded.schoolAuthorization?.grants ?? []),
      ],
      now,
    },
  };
};
