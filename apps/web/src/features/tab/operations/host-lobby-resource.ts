import type { AuthorizationInput } from '@daisy/auth/authorization';
import type { OrganizationAuthority } from '@daisy/db/tab';
import { CommandDenied } from '../commands/run-command';

/** Host-only commands ask about the actual lobby owner, never audience access. */
export const hostLobbyResource = (
  lobby: {
    readonly id: string;
    readonly kind: 'standing' | 'tournament';
  } | null,
  organization: OrganizationAuthority | null,
  ownerActorId: string | null,
): AuthorizationInput['resource'] => {
  if (lobby === null) throw new CommandDenied('not-found');
  if (lobby.kind === 'standing') {
    if (organization === null) throw new CommandDenied('not-found');
    return {
      kind: 'lobby',
      scope: {
        lobbyId: lobby.id,
        lobbyKind: 'standing',
        owner: { kind: 'organization', organization },
      },
      viewing: { audiences: [], releases: [] },
      postingAudiences: [],
    };
  }
  const owner = organization
    ? { kind: 'organization' as const, organization }
    : ownerActorId
      ? { kind: 'person' as const, actorId: ownerActorId }
      : null;
  if (owner === null) throw new CommandDenied('not-found');
  return {
    kind: 'lobby',
    scope: { lobbyId: lobby.id, lobbyKind: 'tournament', owner },
    viewing: { audiences: [], releases: [] },
    postingAudiences: [],
  };
};
