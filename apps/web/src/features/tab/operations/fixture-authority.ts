import type { AuthorizationInput } from '@daisy/auth/authorization';
import type { LoadedResultCommand } from '@daisy/db/tab';
import { CommandDenied } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';
import { hostLobbyResource } from './host-lobby-resource';
import { eventSettingResolution } from './event-setting-resolution';

type Facts = Pick<
  LoadedResultCommand,
  'configuration' | 'authorization' | 'ownerActorId' | 'fixture' | 'connections'
>;
/** Current addressed fixture authority, independent of which command or confirmation consumes it. */
export function fixtureAuthority(
  loaded: Facts,
  principal: TabPrincipal,
  now: string,
): Omit<AuthorizationInput, 'capability'> {
  const lobby = hostLobbyResource(
    loaded.configuration.lobby,
    loaded.authorization.organization,
    loaded.ownerActorId,
  );
  if (lobby.kind !== 'lobby' || lobby.scope.lobbyKind !== 'tournament')
    throw new CommandDenied('not-found');
  return {
    principal,
    resource: {
      kind: 'fixture',
      fixtureId: loaded.fixture.id,
      scope: lobby.scope,
      conflict: {
        connections: loaded.connections,
        handling: eventSettingResolution(loaded.configuration).settings[
          'conflict.handling'
        ].value.value,
        waiverId: null,
      },
      viewing: { audiences: [], releases: [] },
    },
    context: {
      account: loaded.authorization.account,
      grants: loaded.authorization.grants,
      now,
    },
  };
}
