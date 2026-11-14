import { hostLobbyResource } from './host-lobby-resource';
import type { AuthorizationInput } from '@daisy/auth/authorization';
import type {
  LobbyAdministrationCommand,
  LobbyAdministrationFacts,
} from '@daisy/db/tab';
import type { TabPrincipal } from '../tab-principal';
import { CommandDenied } from '../commands/run-command';

type Resource = AuthorizationInput['resource'];
const resourceOf = (
  command: LobbyAdministrationCommand,
  facts: LobbyAdministrationFacts,
): Resource => {
  const organization = facts.organization.organization;
  if (command.type === 'create-lobby') {
    if (command.owner.kind === 'self') {
      if (command.lobby.kind !== 'tournament')
        throw new CommandDenied('not-found');
      return {
        kind: 'lobby_collection',
        proposed: { lobbyKind: 'tournament', owner: { kind: 'person' } },
      };
    }
    if (!organization) throw new CommandDenied('not-found');
    return {
      kind: 'lobby_collection',
      proposed: {
        lobbyKind: command.lobby.kind,
        owner: { kind: 'organization', organization },
      },
    };
  }
  if (
    command.type === 'create-season' ||
    command.type === 'close-season' ||
    command.type === 'set-ladder'
  ) {
    if (!organization) throw new CommandDenied('not-found');
    return organization;
  }
  return hostLobbyResource(
    facts.lobby,
    organization,
    facts.lobby?.ownerActorId ?? null,
  );
};
export const lobbyAdministrationAuthority = (
  principal: TabPrincipal,
  command: LobbyAdministrationCommand,
  facts: LobbyAdministrationFacts,
  context: { readonly now: string; readonly hostingPlan: boolean },
): Omit<AuthorizationInput, 'capability'> => ({
  principal,
  resource: resourceOf(command, facts),
  context: {
    account: facts.organization.account
      ? { ...facts.organization.account, hostingPlan: context.hostingPlan }
      : null,
    grants: facts.organization.grants,
    now: context.now,
  },
});
