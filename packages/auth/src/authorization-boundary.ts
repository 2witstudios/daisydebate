import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import type { AuthorizationInput } from './authorization-facts';
import type {
  BoundaryFact,
  LobbyScopeFact,
  OrganizationAuthorizationFact,
} from './authorization-lobby-facts';
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
 * An organization is inside when the minor belongs to it or it owns a
 * standing lobby the guardian allows. Its tournaments are still asked one
 * by one.
 */
export function organizationInside(
  boundary: BoundaryFact | null | undefined,
  fact: OrganizationAuthorizationFact,
): boolean {
  return (
    !boundary ||
    fact.member ||
    fact.standingLobbyIds.some((lobbyId) =>
      boundary.allowedLobbyIds.includes(lobbyId),
    )
  );
}
const organizationOf = (
  resource: Resource,
): OrganizationAuthorizationFact | null => {
  if (resource.kind === 'organization') return resource;
  return resource.kind === 'template' ? resource.organization : null;
};

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

/**
 * The other people a person-reach capability names on its resource, or null
 * for a resource with no rule here: a capability marked as reaching a person
 * is then refused, never admitted by omission.
 */
function counterpartActorIds(
  resource: Resource,
  actorId: string,
): readonly string[] | null {
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
  // Accepting reaches the inviter and everyone already in the group.
  if (resource.kind === 'group_invitation')
    return others([
      resource.invitation.inviterActorId,
      ...resource.channel.activeMemberActorIds,
    ]);
  // Accepting a request reaches the other person of the direct message.
  if (resource.kind === 'channel')
    return resource.authority.kind === 'dm'
      ? others([resource.authority.lowActorId, resource.authority.highActorId])
      : others(resource.authority.activeMemberActorIds);
  return resource.kind === 'member_history' ? others([resource.actorId]) : null;
}

const bothAnswers: readonly AuthorizationCapability[] = [
  'channel.request.decide',
  'judge.invitation.respond',
];
/** A way out: a withdrawal, or a decline under a capability that is both answers. */
const wayOut = (
  capability: AuthorizationCapability,
  context: AuthorizationInput['context'],
): boolean =>
  isWithdrawal(capability) ||
  (context.answer === 'decline' && bothAnswers.includes(capability));

/**
 * Whether a minor's boundary admits the request. A lobby-reach capability
 * needs the resource's lobby inside it (for an organization or its
 * template, the organization), and a person-reach capability needs every
 * other person reachable in a lobby inside it. A lobby or person whose
 * facts were not loaded is outside. A way out is never bounded.
 */
export function boundaryAdmits(
  actorId: string,
  capability: AuthorizationCapability,
  resource: Resource,
  context: AuthorizationInput['context'],
): boolean {
  const boundary = context.account?.boundary;
  const reach = capabilityMetadata[capability].reach;
  if (!boundary || reach === null || wayOut(capability, context)) return true;
  if (reach === 'lobby') {
    const organization = organizationOf(resource);
    if (organization) return organizationInside(boundary, organization);
    const scope = lobbyScopeOf(resource);
    return scope !== null && insideBoundary(boundary, scope);
  }
  const reached = counterpartActorIds(resource, actorId);
  return (
    reached !== null &&
    reached.every((other) =>
      (context.counterparts ?? []).some(
        (counterpart) =>
          counterpart.actorId === other &&
          counterpart.lobbies.some((scope) => insideBoundary(boundary, scope)),
      ),
    )
  );
}
