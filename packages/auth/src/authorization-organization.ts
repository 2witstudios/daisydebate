import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { organizationInside } from './authorization-boundary';
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
  ownerAuthority,
  type Holder,
} from './authorization-holding';
import {
  adultRelation,
  authorityDecision as under,
  organizationTarget as organization,
  permissionDecision,
  type LobbyRuleContext as Context,
  type ResourceOf as Of,
} from './authorization-permission';
import type { OrganizationAuthorizationFact } from './authorization-lobby-facts';

/**
 * Anyone admitted may read an organization. A minor with a boundary reads
 * the ones they belong to and the ones with a standing lobby inside it.
 */
export const organizationReadable = (
  fact: OrganizationAuthorizationFact,
  context: Context,
): boolean => organizationInside(context.account?.boundary, fact);

export function organizationDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: Of<'organization'>,
  context: Context,
): AuthorizationDecision {
  const target = organization(resource);
  if (capability === 'organization.read')
    return decide(organizationReadable(resource, context));
  if (capability === 'organization.host.read')
    return under(hostAuthority(holder, target));
  if (capability === 'organization.owner.transfer')
    return under(ownerAuthority(holder.actorId, target));
  return permissionDecision(holder, capability, target, context);
}

/** Creating an organization takes an adult; a league also takes the hosting plan. */
export function organizationCreation(
  holder: Holder,
  resource: Of<'organization_collection'>,
  context: Context,
): AuthorizationDecision {
  if (!bandAtLeast(holder.ageBand, 'adult')) return deny('age-band');
  return decide(
    resource.proposedKind === 'school' || context.account?.hostingPlan === true,
  );
}

export function membershipDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: Of<'membership'>,
): AuthorizationDecision {
  const status =
    capability === 'organization.membership.respond' ? 'invited' : 'active';
  return resource.actorId === holder.actorId && resource.status === status
    ? allowRelated('self')
    : deny('missing-capability');
}

/**
 * A guardian link is a relationship between two people. An adult makes
 * their own; a link through a school is made by whoever manages its roster,
 * and whoever manages that roster may change or end it, so a link does not
 * outlive the school's say when the adult it names leaves.
 */
export function guardianLinkDecision(
  holder: Holder,
  capability: AuthorizationCapability,
  resource: Of<'guardian_link'>,
): AuthorizationDecision {
  const guardian = resource.guardianActorId === holder.actorId;
  if (capability === 'guardian.link.read')
    return guardian || resource.wardActorId === holder.actorId
      ? allowRelated(guardian ? 'guardian' : 'ward')
      : deny('missing-capability');
  if (resource.via !== null) {
    const roster = holds(
      holder,
      'school.roster.manage',
      organization(resource.via),
    );
    if (capability === 'guardian.link.create') return holdingDecision(roster);
    if (roster.held) return allowUnder(roster.authority);
  }
  return adultRelation(holder, guardian, 'guardian');
}
