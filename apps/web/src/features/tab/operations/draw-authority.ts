import type { LoadedDrawCommand } from '@daisy/db/tab';
import { CommandDenied } from '../commands/run-command';
import { hostLobbyResource } from './host-lobby-resource';
import type { TabPrincipal } from '../tab-principal';

/** A Draw belongs to the actual tournament owner, even after a discarded draft is gone. */
export function drawAuthority(
  facts: {
    readonly lobby: Parameters<typeof hostLobbyResource>[0];
    readonly authorization: LoadedDrawCommand['authorization'];
    readonly ownerActorId: string | null;
  },
  principal: TabPrincipal,
  now: string,
) {
  const lobby = hostLobbyResource(
    facts.lobby,
    facts.authorization.organization,
    facts.ownerActorId,
  );
  if (lobby.kind !== 'lobby' || lobby.scope.lobbyKind !== 'tournament')
    throw new CommandDenied('not-found');
  return {
    principal,
    resource: {
      kind: 'draw' as const,
      scope: lobby.scope,
      viewing: { audiences: [], releases: [] },
    },
    context: {
      account: facts.authorization.account,
      grants: facts.authorization.grants,
      now,
    },
  };
}
