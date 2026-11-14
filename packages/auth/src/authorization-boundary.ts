import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import type { AuthorizationInput } from './authorization-facts';
import type { BoundaryFact, LobbyScopeFact } from './authorization-lobby-facts';
import { isWithdrawal } from './participant-access';

type Resource = AuthorizationInput['resource'];

/** The lobby a resource is in, when its facts carry one. */
export function lobbyScopeOf(resource: Resource): LobbyScopeFact | null {
  if (resource.kind === 'room' || resource.kind === 'round')
    return resource.owner?.scope ?? null;
  if (resource.kind === 'pending_command') return lobbyScopeOf(resource.target);
  return 'scope' in resource ? resource.scope : null;
}

/**
 * The one statement of a minor's boundary. A lobby is inside when the
 * guardian allows it; a tournament is also inside when the minor holds an
 * accepted entry there, or its owning league has a standing lobby the
 * guardian allows. No boundary puts everything inside.
 */
export function insideBoundary(
  boundary: BoundaryFact | null | undefined,
  scope: LobbyScopeFact,
): boolean {
  if (!boundary) return true;
  if (boundary.allowedLobbyIds.includes(scope.lobbyId)) return true;
  if (scope.lobbyKind !== 'tournament') return false;
  return (
    boundary.entryLobbyIds.includes(scope.lobbyId) ||
    (scope.owner.kind === 'organization' &&
      scope.owner.organization.standingLobbyIds.some((lobbyId) =>
        boundary.allowedLobbyIds.includes(lobbyId),
      ))
  );
}

/**
 * The same boundary for a listing or search that filters in SQL. A bounded
 * listing keeps a lobby when its id is in `lobbyIds`, or it is a tournament
 * whose id is in `tournamentLobbyIds`, or it is a tournament owned by an
 * organization that owns a standing lobby in `ownerStandingLobbyIds`.
 */
export type BoundaryFilter =
  | { readonly kind: 'unbounded' }
  | {
      readonly kind: 'bounded';
      readonly lobbyIds: readonly string[];
      readonly tournamentLobbyIds: readonly string[];
      readonly ownerStandingLobbyIds: readonly string[];
    };
export function boundaryFilter(
  account: { readonly boundary?: BoundaryFact | null } | null,
): BoundaryFilter {
  const boundary = account?.boundary;
  return boundary
    ? {
        kind: 'bounded',
        lobbyIds: boundary.allowedLobbyIds,
        tournamentLobbyIds: boundary.entryLobbyIds,
        ownerStandingLobbyIds: boundary.allowedLobbyIds,
      }
    : { kind: 'unbounded' };
}

/** The other people a person-reach capability names on its resource. */
function counterpartActorIds(
  resource: Resource,
  actorId: string,
): readonly string[] {
  const others = (actorIds: readonly string[]) =>
    actorIds.filter((other) => other !== actorId);
  if (resource.kind === 'contact_pair')
    return others([resource.lowActorId, resource.highActorId]);
  if (resource.kind === 'social_creation')
    return others(
      resource.mode === 'dm'
        ? [resource.recipientActorId]
        : resource.memberActorIds,
    );
  if (resource.kind === 'group_invitation_creation')
    return others(resource.inviteeActorIds);
  return resource.kind === 'member_history' ? others([resource.actorId]) : [];
}

/**
 * Whether a minor's boundary admits the request. A lobby-reach capability
 * needs the resource's lobby inside it, and a person-reach capability needs
 * every other person reachable in a lobby inside it. A lobby or person
 * whose facts were not loaded is outside. Withdrawals are never bounded.
 */
export function boundaryAdmits(
  actorId: string,
  capability: AuthorizationCapability,
  resource: Resource,
  context: AuthorizationInput['context'],
): boolean {
  const boundary = context.account?.boundary;
  const reach = capabilityMetadata[capability].reach;
  if (!boundary || reach === null || isWithdrawal(capability)) return true;
  if (reach === 'lobby') {
    const scope = lobbyScopeOf(resource);
    return scope !== null && insideBoundary(boundary, scope);
  }
  return counterpartActorIds(resource, actorId).every((other) =>
    (context.counterparts ?? []).some(
      (counterpart) =>
        counterpart.actorId === other &&
        counterpart.lobbies.some((scope) => insideBoundary(boundary, scope)),
    ),
  );
}
