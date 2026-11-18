import type {
  OrganizationCommand,
  OrganizationRefusal,
} from '@daisy/protocol/lobby/organization-command';
import { refuse, type CommandDecision } from './run-command';
import type {
  GrantFact,
  OrganizationFacts,
  OrganizationWrite,
} from './organization';

type GrantCommand = Extract<
  OrganizationCommand,
  { readonly type: 'give-grant' | 'remove-grant' }
>;
type Decision = CommandDecision<
  OrganizationRefusal | 'not-found',
  OrganizationWrite
>;
type Organization = NonNullable<OrganizationFacts['organization']>;
type Lobby = NonNullable<OrganizationFacts['lobby']>;
type Target =
  | { readonly kind: 'organization'; readonly row: Organization }
  | {
      readonly kind: 'lobby';
      readonly row: Lobby;
      readonly owner: Organization | null;
    };
const targetOf = (
  facts: OrganizationFacts,
  scope: GrantCommand['scope'],
): Target | null => {
  if (scope.kind === 'organization')
    return facts.organization?.id === scope.organizationId
      ? { kind: 'organization', row: facts.organization }
      : null;
  const lobby = facts.lobby;
  if (!lobby || lobby.id !== scope.lobbyId) return null;
  if (
    lobby.ownerOrganizationId !== null &&
    lobby.ownerOrganizationId !== facts.organization?.id
  )
    return null;
  return {
    kind: 'lobby',
    row: lobby,
    owner: lobby.ownerOrganizationId === null ? null : facts.organization,
  };
};
const organizationIdOf = (target: Target): string | null =>
  target.kind === 'organization'
    ? target.row.id
    : target.row.ownerOrganizationId;
const owns = (target: Target, userId: string): boolean =>
  target.kind === 'organization'
    ? target.row.ownerUserId === userId
    : target.row.ownerUserId === userId || target.owner?.ownerUserId === userId;
const matches = (grant: GrantFact, target: Target): boolean =>
  target.kind === 'organization'
    ? grant.scopeKind === 'organization' &&
      grant.organizationId === target.row.id
    : grant.scopeKind === 'lobby' && grant.lobbyId === target.row.id;
const covering = (
  facts: OrganizationFacts,
  target: Target,
): readonly GrantFact[] =>
  facts.grants.filter((grant) => {
    if (
      grant.userId !== facts.senderUserId ||
      grant.revokedAt !== null ||
      (grant.expiresAt !== null &&
        Date.parse(grant.expiresAt) <= Date.parse(facts.now))
    )
      return false;
    if (grant.scopeKind === 'lobby')
      return target.kind === 'lobby' && grant.lobbyId === target.row.id;
    const organizationId = organizationIdOf(target);
    return (
      organizationId !== null &&
      grant.organizationId === organizationId &&
      facts.memberships.some(
        (member) =>
          member.organizationId === organizationId &&
          member.userId === facts.senderUserId &&
          member.status === 'active',
      )
    );
  });
const accepted = (
  target: Target,
  writes: readonly OrganizationWrite[],
): Decision => ({
  kind: 'accepted',
  aggregate: { kind: target.kind, id: target.row.id },
  resultingVersion: target.row.version + 1,
  writes: [
    target.kind === 'organization'
      ? {
          table: 'organizations',
          op: 'update',
          id: target.row.id,
          set: { version: target.row.version + 1 },
        }
      : {
          table: 'lobbies',
          op: 'update',
          id: target.row.id,
          set: { version: target.row.version + 1 },
        },
    ...writes,
  ],
  findings: [],
  fixtureChanges: [],
});
/** Scope-first grant decisions use role provenance only to decide which roles are available. */
export const decideGrant = (
  facts: OrganizationFacts,
  command: GrantCommand,
): Decision => {
  const target = targetOf(facts, command.scope);
  if (!target) return refuse('not-found');
  const held = covering(facts, target),
    owner = owns(target, facts.senderUserId);
  if (command.type === 'remove-grant') {
    const grant = facts.grants.find(
      (one) => one.id === command.grantId && matches(one, target),
    );
    if (!grant) return refuse('not-found');
    if (grant.revokedAt !== null) return refuse('grant-ended');
    if (!owner && !held.some((one) => one.role.rank < grant.role.rank))
      return refuse('outranked');
    return accepted(target, [
      {
        table: 'grants',
        op: 'update',
        id: grant.id,
        set: { revokedAt: facts.now, revokedByUserId: facts.senderUserId },
      },
      { table: 'users', op: 'update', id: grant.userId, increment: 'version' },
    ]);
  }
  const role = facts.role;
  if (
    !role ||
    (!role.preset && role.organizationId !== organizationIdOf(target))
  )
    return refuse('role-unavailable');
  if (!owner) {
    if (!held.length) return refuse('scope-not-covered');
    const permissions = new Set(held.flatMap((one) => one.role.permissions));
    if (!role.permissions.every((permission) => permissions.has(permission)))
      return refuse('permission-not-held');
    if (!held.some((one) => one.role.rank < role.rank))
      return refuse('role-not-below');
  }
  if (
    target.kind === 'organization' &&
    !facts.memberships.some(
      (one) =>
        one.organizationId === target.row.id &&
        one.userId === command.userId &&
        one.status === 'active',
    )
  )
    return refuse('not-a-member');
  const minimum = role.permissions.some((permission) =>
    permission.startsWith('school.'),
  )
    ? 'adult'
    : facts.staffMinimumBand;
  if (
    facts.personAgeBand !== 'adult' &&
    !(minimum === '16-17' && facts.personAgeBand === '16-17')
  )
    return refuse('age-band');
  if (
    command.expiresAt !== null &&
    Date.parse(command.expiresAt) <= Date.parse(facts.now)
  )
    return refuse('expiry-passed');
  if (
    facts.grants.some(
      (grant) =>
        grant.userId === command.userId &&
        grant.role.id === role.id &&
        grant.revokedAt === null &&
        matches(grant, target),
    )
  )
    return refuse('already-granted');
  return accepted(target, [
    {
      table: 'grants',
      op: 'insert',
      row: {
        id: facts.newId,
        roleId: role.id,
        userId: command.userId,
        scopeKind: target.kind,
        organizationId: target.kind === 'organization' ? target.row.id : null,
        lobbyId: target.kind === 'lobby' ? target.row.id : null,
        grantedByUserId: facts.senderUserId,
        grantedAt: facts.now,
        expiresAt: command.expiresAt,
      },
    },
    { table: 'users', op: 'update', id: command.userId, increment: 'version' },
  ]);
};
