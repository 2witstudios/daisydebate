import { hostLobbyResource } from './host-lobby-resource';
import type { AuthorizationInput } from '@daisy/auth/authorization';
import type { LoadedSettingCommand } from '@daisy/db/tab';
import type { SettingCommand } from '@daisy/protocol/lobby/setting-command';
import { CommandDenied } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';

type Resource = AuthorizationInput['resource'];
const resource = (
  command: SettingCommand,
  loaded: LoadedSettingCommand,
): Resource => {
  const organization = loaded.authorization.organization;
  const onLobby =
    'lobbyId' in command ||
    'eventId' in command ||
    ('scope' in command &&
      (command.scope.kind === 'lobby' || command.scope.kind === 'event'));
  if (!onLobby) {
    if (!organization) throw new CommandDenied('not-found');
    return organization;
  }
  return hostLobbyResource(
    loaded.named.lobby,
    organization,
    loaded.ownerActorId,
  );
};
export const settingAuthority = (
  principal: TabPrincipal,
  command: SettingCommand,
  loaded: LoadedSettingCommand,
  now: string,
): Omit<AuthorizationInput, 'capability'> => ({
  principal,
  resource: resource(command, loaded),
  context: {
    account: loaded.authorization.account,
    grants: loaded.authorization.grants,
    now,
  },
});
