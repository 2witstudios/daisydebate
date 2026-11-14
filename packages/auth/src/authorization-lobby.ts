import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import {
  allowRelated,
  allowUnder,
  decide,
  deny,
  type AuthorizationDecision,
} from './authorization-decision';
import {
  bandAtLeast,
  holdingDecision,
  holds,
  hostAuthority,
  type Holder,
} from './authorization-holding';
import {
  authorityDecision as under,
  lobbyTarget as lobby,
  organizationTarget as organization,
  permissionDecision,
  type LobbyRuleContext as Context,
  type ResourceOf as Of,
} from './authorization-permission';
import { audienceDecision } from './authorization-audience';
import type { AuthorizationInput } from './authorization-facts';
import type { LobbyResourceFact } from './authorization-lobby-facts';
import {
  guardianLinkDecision,
  membershipDecision,
  organizationCreation,
  organizationDecision,
  organizationReadable,
} from './authorization-organization';
import {
  audienceRead,
  entryDecision,
  judgeDecision,
  pendingCommandDecision,
  resolutionDecision,
  sanctionDecision,
  type DecideOn,
} from './authorization-tournament';

/**
 * A person hosts a tournament on the hosting plan. A league's tournament
 * takes `lobby.setup.manage` on the league, and a standing lobby takes
 * `organization.manage` on the organization that will own it.
 */
function lobbyCreation(
  holder: Holder,
  resource: Of<'lobby_collection'>,
  context: Context,
): AuthorizationDecision {
  if (!bandAtLeast(holder.ageBand, 'adult')) return deny('age-band');
  const { lobbyKind, owner } = resource.proposed;
  if (owner.kind === 'person')
    return decide(context.account?.hostingPlan === true);
  if (lobbyKind === 'standing')
    return holdingDecision(
      holds(holder, 'organization.manage', organization(owner.organization)),
    );
  return owner.organization.organizationKind === 'league'
    ? holdingDecision(
        holds(holder, 'lobby.setup.manage', organization(owner.organization)),
      )
    : deny('denied');
}

/**
 * A lobby is read by its host readers, and otherwise by a viewer in an
 * audience its postings ever open to. Its Rooms are listed to the same
 * people; a Room is made there by a participant.
 */
function lobbyResourceDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: Of<'lobby'>,
  context: Context,
): AuthorizationDecision {
  const target = lobby(resource.scope);
  const host = hostAuthority(holder, target);
  if (capability === 'lobby.host.read') return under(host);
  if (capability === 'lobby.read' || capability === 'room.list') {
    if (host) return allowUnder(host);
    const audiences = [...resource.viewing.audiences, 'link', 'public'];
    return resource.postingAudiences.some((audience) =>
      audiences.includes(audience),
    )
      ? allowRelated('audience')
      : deny('missing-capability');
  }
  if (capability === 'lobby.room.create')
    return decide(resource.viewing.audiences.includes('participants'));
  if (capability === 'standings.read')
    return audienceDecision(
      holder,
      resource.scope,
      'decision',
      resource.viewing,
      null,
    );
  return permissionDecision(holder, capability, target, context);
}

/** Whether a resource belongs to the lobby rules. */
export const isLobbyResource = (
  resource: AuthorizationInput['resource'],
): resource is LobbyResourceFact => lobbyResourceKinds.includes(resource.kind);
const lobbyResourceKinds: readonly string[] = [
  'organization_collection',
  'organization',
  'membership',
  'guardian_link',
  'lobby_collection',
  'lobby',
  'template',
  'entry',
  'judge',
  'tab_round',
  'draw',
  'fixture',
  'ballot',
  'pending_command',
  'sanction',
] satisfies readonly LobbyResourceFact['kind'][];

/** The decision for an admitted member on an organization, a lobby or anything in one. */
export function lobbyDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: LobbyResourceFact,
  context: Context,
  decideOn: DecideOn,
): AuthorizationDecision {
  switch (resource.kind) {
    case 'organization_collection':
      return organizationCreation(holder, resource, context);
    case 'organization':
      return organizationDecision(holder, capability, resource, context);
    case 'membership':
      return membershipDecision(holder, capability, resource);
    case 'guardian_link':
      return guardianLinkDecision(holder, capability, resource);
    case 'lobby_collection':
      return lobbyCreation(holder, resource, context);
    case 'lobby':
      return lobbyResourceDecision(holder, capability, resource, context);
    case 'template':
      return capability === 'template.read'
        ? decide(organizationReadable(resource.organization, context))
        : permissionDecision(
            holder,
            capability,
            organization(resource.organization),
            context,
          );
    case 'entry':
      return entryDecision(holder, resource);
    case 'judge':
      return judgeDecision(holder, capability, resource);
    case 'tab_round':
      return capability === 'resolution.read'
        ? resolutionDecision(holder, resource)
        : permissionDecision(
            holder,
            capability,
            lobby(resource.scope),
            context,
          );
    case 'draw':
    case 'fixture':
    case 'ballot':
      return (
        audienceRead(holder, capability, resource) ??
        permissionDecision(holder, capability, lobby(resource.scope), context)
      );
    case 'pending_command':
      return pendingCommandDecision(holder, capability, resource, decideOn);
    case 'sanction':
      return sanctionDecision(holder, resource);
  }
}
