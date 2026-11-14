import type { AgeBand } from '@daisy/auth';
import type {
  OrganizationCommand,
  OrganizationRefusal,
} from '@daisy/protocol/lobby/organization-command';
import type {
  GrantScopeKind,
  MembershipStatus,
  OrganizationKind,
  Permission,
} from '@daisy/protocol/lobby';
import { refuse, type CommandDecision } from './run-command';

/**
 * The organization and grant commands' decisions (TAB-5.9): the rules that
 * span rows, each with its named refusal. Authority is the runner's gate;
 * time and new ids come in the facts.
 */

/** An `organizations` row, as the commands read it. */
export type OrganizationRow = {
  readonly id: string;
  readonly kind: OrganizationKind;
  readonly name: string;
  readonly handle: string;
  readonly ownerUserId: string | null;
  readonly version: number;
};
/** A `memberships` row. */
export type MembershipRow = {
  readonly organizationId: string;
  readonly userId: string;
  readonly status: MembershipStatus;
  readonly version: number;
};
/** A `roles` row with its `role_permissions`. */
export type RoleFact = {
  readonly id: string;
  readonly organizationId: string;
  /** 1 is the highest. */
  readonly rank: number;
  readonly preset: boolean;
  readonly permissions: readonly Permission[];
};
/** A `grants` row with its role, and the organization its scope belongs to. */
export type GrantFact = {
  readonly id: string;
  readonly userId: string;
  readonly scopeKind: GrantScopeKind;
  readonly organizationId: string | null;
  readonly lobbyId: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  /** The organization itself, or the organization that owns the lobby. */
  readonly scopeOrganizationId: string;
  readonly role: RoleFact;
};

export type OrganizationFacts = {
  readonly now: string;
  readonly senderUserId: string;
  /** The id minted at the edge for the row a command inserts. */
  readonly newId: string;
  /** Null only for `create-organization`. */
  readonly organization: OrganizationRow | null;
  /** Whether another organization holds the handle, case-insensitively. */
  readonly handleTaken: boolean;
  /** This organization's rows for the sender and the person named. */
  readonly memberships: readonly MembershipRow[];
  /**
   * The grants of the sender and of the person named in this organization
   * and its lobbies, and the grant a command names.
   */
  readonly grants: readonly GrantFact[];
  /** The role `give-grant` names; null when no such role exists. */
  readonly role: RoleFact | null;
  /** For a lobby-scope grant: the organization that owns the lobby, if any. */
  readonly lobbyOwnerOrganizationId: string | null;
  /** The age band of the person named; null when unknown. */
  readonly personAgeBand: AgeBand | null;
  /** `staff.minimum_band` resolved at this organization. */
  readonly staffMinimumBand: 'adult' | '16-17';
};

export type OrganizationWrite =
  | {
      readonly table: 'organizations';
      readonly op: 'insert';
      readonly row: Omit<OrganizationRow, 'version'>;
    }
  | {
      readonly table: 'organizations';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly name?: string;
        readonly ownerUserId?: string;
        readonly version: number;
      };
    }
  | {
      readonly table: 'memberships';
      readonly op: 'insert';
      readonly row: {
        readonly organizationId: string;
        readonly userId: string;
        readonly status: 'invited' | 'active';
        readonly joinedAt: string | null;
      };
    }
  | {
      readonly table: 'memberships';
      readonly op: 'update';
      readonly key: {
        readonly organizationId: string;
        readonly userId: string;
      };
      readonly set: {
        readonly status: MembershipStatus;
        readonly joinedAt?: string | null;
        readonly endedAt: string | null;
        readonly version: number;
      };
    }
  | {
      readonly table: 'grants';
      readonly op: 'insert';
      readonly row: {
        readonly id: string;
        readonly roleId: string;
        readonly userId: string;
        readonly scopeKind: GrantScopeKind;
        readonly organizationId: string | null;
        readonly lobbyId: string | null;
        readonly grantedByUserId: string;
        readonly grantedAt: string;
        readonly expiresAt: string | null;
      };
    }
  | {
      readonly table: 'grants';
      readonly op: 'update';
      readonly id: string;
      readonly set: {
        readonly revokedAt: string;
        readonly revokedByUserId: string;
      };
    }
  /** Moves the account's revision, so stale authority is dropped. */
  | {
      readonly table: 'users';
      readonly op: 'update';
      readonly id: string;
      readonly increment: 'version';
    };

/** A command's own refusals, and the shared `not-found` for a row it names that is not there. */
export type OrganizationDecisionRefusal = OrganizationRefusal | 'not-found';
type Decision = CommandDecision<OrganizationDecisionRefusal, OrganizationWrite>;

const live = (grant: GrantFact, now: string): boolean =>
  grant.revokedAt === null &&
  (grant.expiresAt === null || Date.parse(grant.expiresAt) > Date.parse(now));

/** A grant covers a scope when it is that scope or the organization above it. */
const covers = (
  grant: GrantFact,
  organizationId: string,
  scope:
    | { readonly kind: 'organization' }
    | { readonly kind: 'lobby'; readonly lobbyId: string },
): boolean =>
  grant.scopeKind === 'organization'
    ? grant.organizationId === organizationId
    : scope.kind === 'lobby' && grant.lobbyId === scope.lobbyId;

const highestRank = (grants: readonly GrantFact[]): number =>
  Math.min(...grants.map((grant) => grant.role.rank));

/**
 * Whether the sender may act on a person ranked `rank`: the owner always;
 * anyone else only from a role ranked above it.
 */
const outranks = (
  facts: OrganizationFacts,
  organization: OrganizationRow,
  rank: number,
) =>
  organization.ownerUserId === facts.senderUserId ||
  highestRank(
    facts.grants.filter(
      (grant) =>
        grant.userId === facts.senderUserId &&
        live(grant, facts.now) &&
        covers(grant, organization.id, { kind: 'organization' }),
    ),
  ) < rank;

const membershipOf = (facts: OrganizationFacts, userId: string) =>
  facts.memberships.find((membership) => membership.userId === userId) ?? null;

const accepted = (
  organization: { readonly id: string; readonly version: number },
  writes: readonly OrganizationWrite[],
  set: { readonly name?: string; readonly ownerUserId?: string } = {},
): Decision => ({
  kind: 'accepted',
  aggregate: { kind: 'organization', id: organization.id },
  resultingVersion: organization.version + 1,
  writes: [
    {
      table: 'organizations',
      op: 'update',
      id: organization.id,
      set: { ...set, version: organization.version + 1 },
    },
    ...writes,
  ],
  findings: [],
  fixtureChanges: [],
});

const bump = (userId: string): OrganizationWrite => ({
  table: 'users',
  op: 'update',
  id: userId,
  increment: 'version',
});

function createOrganization(
  facts: OrganizationFacts,
  command: Extract<OrganizationCommand, { type: 'create-organization' }>,
): Decision {
  if (facts.handleTaken) return refuse('handle-taken');
  const id = facts.newId;
  return {
    kind: 'accepted',
    aggregate: { kind: 'organization', id },
    resultingVersion: 1,
    writes: [
      {
        table: 'organizations',
        op: 'insert',
        row: {
          id,
          kind: command.kind,
          name: command.name,
          handle: command.handle,
          ownerUserId: facts.senderUserId,
        },
      },
      {
        table: 'memberships',
        op: 'insert',
        row: {
          organizationId: id,
          userId: facts.senderUserId,
          status: 'active',
          joinedAt: facts.now,
        },
      },
    ],
    findings: [],
    fixtureChanges: [],
  };
}

function inviteMember(
  facts: OrganizationFacts,
  organization: OrganizationRow,
  userId: string,
): Decision {
  const membership = membershipOf(facts, userId);
  if (membership === null)
    return accepted(organization, [
      {
        table: 'memberships',
        op: 'insert',
        row: {
          organizationId: organization.id,
          userId,
          status: 'invited',
          joinedAt: null,
        },
      },
    ]);
  switch (membership.status) {
    case 'invited':
    case 'active':
      return refuse('already-member');
    case 'declined':
    case 'ended':
      // Rejoining reopens the one row.
      return accepted(organization, [
        {
          table: 'memberships',
          op: 'update',
          key: { organizationId: organization.id, userId },
          set: {
            status: 'invited',
            joinedAt: null,
            endedAt: null,
            version: membership.version + 1,
          },
        },
      ]);
  }
}

function respond(
  facts: OrganizationFacts,
  organization: OrganizationRow,
  answer: 'active' | 'declined',
): Decision {
  const membership = membershipOf(facts, facts.senderUserId);
  if (membership?.status !== 'invited') return refuse('invitation-closed');
  return accepted(organization, [
    {
      table: 'memberships',
      op: 'update',
      key: { organizationId: organization.id, userId: facts.senderUserId },
      set: {
        status: answer,
        joinedAt: answer === 'active' ? facts.now : null,
        endedAt: null,
        version: membership.version + 1,
      },
    },
  ]);
}

const revoke = (
  facts: OrganizationFacts,
  grant: GrantFact,
): OrganizationWrite => ({
  table: 'grants',
  op: 'update',
  id: grant.id,
  set: { revokedAt: facts.now, revokedByUserId: facts.senderUserId },
});

function endMembership(
  facts: OrganizationFacts,
  organization: OrganizationRow,
  userId: string,
): Decision {
  const membership = membershipOf(facts, userId);
  if (membership?.status !== 'active') return refuse('not-a-member');
  if (organization.ownerUserId === userId) return refuse('last-owner');
  const theirs = facts.grants.filter(
    (grant) =>
      grant.userId === userId &&
      grant.revokedAt === null &&
      grant.scopeKind === 'organization' &&
      grant.organizationId === organization.id,
  );
  if (
    userId !== facts.senderUserId &&
    theirs.length > 0 &&
    !outranks(facts, organization, highestRank(theirs))
  )
    return refuse('outranked');
  return accepted(organization, [
    {
      table: 'memberships',
      op: 'update',
      key: { organizationId: organization.id, userId },
      set: {
        status: 'ended',
        endedAt: facts.now,
        version: membership.version + 1,
      },
    },
    // Its grants end in the same step.
    ...theirs.map((grant) => revoke(facts, grant)),
    bump(userId),
  ]);
}

const schoolOnly = (permission: Permission): boolean =>
  permission.startsWith('school.');

/** Whether the person's band meets what the role needs. */
const bandAllows = (facts: OrganizationFacts, role: RoleFact): boolean => {
  const needed = role.permissions.some(schoolOnly)
    ? 'adult'
    : facts.staffMinimumBand;
  return (
    facts.personAgeBand === 'adult' ||
    (needed === '16-17' && facts.personAgeBand === '16-17')
  );
};

/** Rule 5: the giver holds every permission of the role at a covering scope, ranked above it. */
function giveGrant(
  facts: OrganizationFacts,
  organization: OrganizationRow,
  command: Extract<OrganizationCommand, { type: 'give-grant' }>,
): Decision {
  const role = facts.role;
  if (
    role === null ||
    (!role.preset && role.organizationId !== organization.id)
  )
    return refuse('role-unavailable');
  if (
    command.scope.kind === 'lobby' &&
    facts.lobbyOwnerOrganizationId !== organization.id
  )
    return refuse('scope-not-covered');
  const owner = organization.ownerUserId === facts.senderUserId;
  if (!owner) {
    const covering = facts.grants.filter(
      (grant) =>
        grant.userId === facts.senderUserId &&
        live(grant, facts.now) &&
        covers(grant, organization.id, command.scope),
    );
    if (covering.length === 0) return refuse('scope-not-covered');
    const held = new Set(covering.flatMap((grant) => grant.role.permissions));
    if (!role.permissions.every((permission) => held.has(permission)))
      return refuse('permission-not-held');
    if (highestRank(covering) >= role.rank) return refuse('role-not-below');
  }
  if (
    command.scope.kind === 'organization' &&
    membershipOf(facts, command.userId)?.status !== 'active'
  )
    return refuse('not-a-member');
  if (!bandAllows(facts, role)) return refuse('age-band');
  if (
    command.expiresAt !== null &&
    Date.parse(command.expiresAt) <= Date.parse(facts.now)
  )
    return refuse('expiry-passed');
  const lobbyId = command.scope.kind === 'lobby' ? command.scope.lobbyId : null;
  if (
    facts.grants.some(
      (grant) =>
        grant.userId === command.userId &&
        grant.revokedAt === null &&
        grant.role.id === role.id &&
        (lobbyId === null
          ? grant.scopeKind === 'organization' &&
            grant.organizationId === organization.id
          : grant.lobbyId === lobbyId),
    )
  )
    return refuse('already-granted');
  const id = facts.newId;
  return accepted(organization, [
    {
      table: 'grants',
      op: 'insert',
      row: {
        id,
        roleId: role.id,
        userId: command.userId,
        scopeKind: command.scope.kind,
        organizationId: lobbyId === null ? organization.id : null,
        lobbyId,
        grantedByUserId: facts.senderUserId,
        grantedAt: facts.now,
        expiresAt: command.expiresAt,
      },
    },
    bump(command.userId),
  ]);
}

function removeGrant(
  facts: OrganizationFacts,
  organization: OrganizationRow,
  grantId: string,
): Decision {
  const grant = facts.grants.find((candidate) => candidate.id === grantId);
  if (grant?.scopeOrganizationId !== organization.id)
    return refuse('not-found');
  if (grant.revokedAt !== null) return refuse('grant-ended');
  if (!outranks(facts, organization, grant.role.rank))
    return refuse('outranked');
  return accepted(organization, [revoke(facts, grant), bump(grant.userId)]);
}

/** Decides one organization or grant command against its facts. */
export function decideOrganization(
  facts: OrganizationFacts,
  command: OrganizationCommand,
): Decision {
  if (command.type === 'create-organization')
    return createOrganization(facts, command);
  const organization = facts.organization;
  if (organization?.id !== command.organizationId) return refuse('not-found');
  switch (command.type) {
    case 'update-organization':
      return accepted(organization, [], { name: command.name });
    case 'invite-member':
      return inviteMember(facts, organization, command.userId);
    case 'accept-membership':
      return respond(facts, organization, 'active');
    case 'decline-membership':
      return respond(facts, organization, 'declined');
    case 'end-membership':
      return endMembership(facts, organization, command.userId);
    case 'give-grant':
      return giveGrant(facts, organization, command);
    case 'remove-grant':
      return removeGrant(facts, organization, command.grantId);
    case 'transfer-ownership':
      return membershipOf(facts, command.userId)?.status === 'active'
        ? accepted(organization, [], { ownerUserId: command.userId })
        : refuse('not-a-member');
  }
}
