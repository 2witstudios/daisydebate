import type { Permission } from '@daisy/protocol/authorization';
import { capabilityMetadata } from '@daisy/protocol/capability-metadata';
import type { AgeBand } from './age-band';
import {
  allowUnder,
  deny,
  type AuthorizationDecision,
  type DecisionAuthority,
} from './authorization-decision';
import type { AuthorizationInput } from './authorization-facts';
import type {
  GrantFact,
  LobbyScopeFact,
  OrganizationAuthorizationFact,
} from './authorization-lobby-facts';

/** The admitted person asking, with the facts every lobby rule reads. */
export type Holder = {
  readonly actorId: string;
  readonly ageBand: AgeBand | null;
  readonly grants: readonly GrantFact[];
  readonly now: string | undefined;
};
export const holderOf = (
  actorId: string,
  context: AuthorizationInput['context'],
): Holder => ({
  actorId,
  ageBand: context.account?.ageBand ?? null,
  grants: context.grants ?? [],
  now: context.now,
});

/** Where authority is asked for: an organization, or a lobby. */
export type AuthorityTarget =
  | {
      readonly kind: 'organization';
      readonly organization: OrganizationAuthorizationFact;
    }
  | { readonly kind: 'lobby'; readonly scope: LobbyScopeFact };

const bands: readonly AgeBand[] = ['under-13', '13-15', '16-17', 'adult'];
/** Whether a person's band is at or above a minimum; no band never is. */
export const bandAtLeast = (band: AgeBand | null, minimum: AgeBand): boolean =>
  band !== null && bands.indexOf(band) >= bands.indexOf(minimum);

const owningOrganization = (
  target: AuthorityTarget,
): OrganizationAuthorizationFact | null => {
  if (target.kind === 'organization') return target.organization;
  const owner = target.scope.owner;
  return owner.kind === 'organization' ? owner.organization : null;
};

/** Owner is a fixed position on a lobby or on the organization that owns it. */
export function ownerAuthority(
  actorId: string,
  target: AuthorityTarget,
): DecisionAuthority | null {
  if (
    target.kind === 'lobby' &&
    target.scope.owner.kind === 'person' &&
    target.scope.owner.actorId === actorId
  )
    return {
      kind: 'owner',
      of: { kind: 'lobby', lobbyId: target.scope.lobbyId },
    };
  const organization = owningOrganization(target);
  return organization?.ownerActorIds.includes(actorId)
    ? {
        kind: 'owner',
        of: {
          kind: 'organization',
          organizationId: organization.organizationId,
        },
      }
    : null;
}

/** An unexpired grant whose membership still stands. Unknown time is expired. */
const live = (grant: GrantFact, now: string | undefined): boolean =>
  Number.isSafeInteger(grant.revision) &&
  grant.revision > 0 &&
  grant.membershipActive &&
  (grant.expiresAt === null ||
    (now !== undefined && Date.parse(grant.expiresAt) > Date.parse(now)));

/** A grant covers a lobby from the lobby itself or from its owning organization. */
const covers = (grant: GrantFact, target: AuthorityTarget): boolean =>
  grant.scope.kind === 'lobby'
    ? target.kind === 'lobby' && target.scope.lobbyId === grant.scope.lobbyId
    : owningOrganization(target)?.organizationId === grant.scope.organizationId;

const narrowestFirst = (a: GrantFact, b: GrantFact): number => {
  if (a.scope.kind !== b.scope.kind) return a.scope.kind === 'lobby' ? -1 : 1;
  if (a.grantId === b.grantId) return 0;
  return a.grantId < b.grantId ? -1 : 1;
};

/** The person's live grants covering the target, narrowest scope then lowest id. */
export const coveringGrants = (
  holder: Holder,
  target: AuthorityTarget,
): readonly GrantFact[] =>
  holder.grants
    .filter((grant) => live(grant, holder.now) && covers(grant, target))
    .sort(narrowestFirst);

export type Holding =
  | { readonly held: true; readonly authority: DecisionAuthority }
  | {
      readonly held: false;
      readonly reason: 'missing-capability' | 'age-band';
    };
const notHeld = (underAge: boolean): Holding => ({
  held: false,
  reason: underAge ? 'age-band' : 'missing-capability',
});

/**
 * Whether the person holds a permission on the target: as its owner, or by a
 * live covering grant whose role includes it. A school permission is held
 * only at that school. Permissions only add; there is no deny grant.
 */
export function holds(
  holder: Holder,
  permission: Permission,
  target: AuthorityTarget,
): Holding {
  const { organizationKind } = capabilityMetadata[permission];
  const school = organizationKind === 'school';
  if (
    organizationKind !== null &&
    (target.kind !== 'organization' ||
      target.organization.organizationKind !== organizationKind)
  )
    return notHeld(false);
  const owner = ownerAuthority(holder.actorId, target);
  if (owner && bandAtLeast(holder.ageBand, 'adult'))
    return { held: true, authority: owner };
  const granted = coveringGrants(holder, target).filter((grant) =>
    grant.permissions.includes(permission),
  );
  const grant = granted.find((candidate) =>
    bandAtLeast(holder.ageBand, school ? 'adult' : candidate.staffMinimumBand),
  );
  return grant
    ? { held: true, authority: { kind: 'grant', grantId: grant.grantId } }
    : notHeld(owner !== null || granted.length > 0);
}

export const holdingDecision = (holding: Holding): AuthorizationDecision =>
  holding.held ? allowUnder(holding.authority) : deny(holding.reason);

/**
 * A host reader: the owner, or anyone with a live covering grant they are
 * old enough to use. The grant need hold no permission.
 */
export function hostAuthority(
  holder: Holder,
  target: AuthorityTarget,
): DecisionAuthority | null {
  const owner = ownerAuthority(holder.actorId, target);
  if (owner && bandAtLeast(holder.ageBand, 'adult')) return owner;
  const grant = coveringGrants(holder, target).find((candidate) =>
    bandAtLeast(holder.ageBand, candidate.staffMinimumBand),
  );
  return grant ? { kind: 'grant', grantId: grant.grantId } : null;
}
