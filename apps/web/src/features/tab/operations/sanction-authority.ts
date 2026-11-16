import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import type { SanctionCommandFacts } from '@daisy/db/tab';
import type { SanctionCommand } from '@daisy/protocol/lobby/sanction-command';
import { CommandDenied } from '../commands/run-command';
import { hostLobbyResource } from './host-lobby-resource';
import type { TabPrincipal } from '../tab-principal';

type Authorize = (input: AuthorizationInput) => AuthorizationDecision;
/** A withdrawal's two permissions mean two actual scopes, never an interchangeable role name. */
export const sanctionAuthorization =
  (command: SanctionCommand, authorize: Authorize): Authorize =>
  (input) => {
    if (
      command.type === 'withdraw-sanction' &&
      ((input.resource.kind === 'organization' &&
        input.capability !== 'organization.manage') ||
        (input.resource.kind === 'lobby' &&
          input.capability !== 'lobby.setup.manage'))
    )
      return { allow: false, reason: 'missing-capability', conflict: null };
    return authorize(input);
  };
export function sanctionAuthority(
  principal: TabPrincipal,
  command: SanctionCommand,
  facts: SanctionCommandFacts,
  authorize: Authorize,
) {
  const league = facts.organization.organization;
  if (!league) throw new CommandDenied('not-found');
  const atLeague = {
    principal,
    resource: league,
    context: {
      account: facts.organization.account,
      grants: facts.organization.grants,
      now: facts.now,
    },
  };
  const atLobby = {
    principal,
    resource: hostLobbyResource(
      facts.lobby.lobby,
      facts.lobby.authorization.organization,
      facts.lobby.ownerActorId,
    ),
    context: {
      account: facts.lobby.authorization.account,
      grants: facts.lobby.authorization.grants,
      now: facts.now,
    },
  };
  const leagueAllowed = () =>
    authorize({ ...atLeague, capability: 'organization.manage' }).allow;
  const lobbyAllowed = () =>
    authorize({ ...atLobby, capability: 'lobby.setup.manage' }).allow;
  if (
    command.type === 'request-sanction' ||
    (command.type === 'withdraw-sanction' && !leagueAllowed())
  ) {
    if (!lobbyAllowed()) throw new CommandDenied('not-found');
    return {
      authority: atLobby,
      scope: { kind: 'lobby' as const, lobbyId: facts.lobby.lobby.id },
    };
  }
  if (!leagueAllowed()) throw new CommandDenied('not-found');
  return {
    authority: atLeague,
    scope: {
      kind: 'organization' as const,
      organizationId: league.organizationId,
    },
  };
}
