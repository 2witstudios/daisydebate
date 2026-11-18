import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  EventSettingParentsChanged,
  roleAuthorityOf,
  type LobbyPeopleFacts,
  type RoleRow,
  type TabStore,
} from '@daisy/db/tab';
import { idSchema } from '@daisy/protocol';
import {
  lobbyPeopleViewSchema,
  type LobbyPeopleView,
} from '@daisy/protocol/lobby/lobby-people-read';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import type { TabPrincipal } from '../tab-principal';

/** A lobby's grant recipients are independent of membership in its owning organization. */
export const lobbyPeopleOf = (
  facts: LobbyPeopleFacts,
  now: string,
  managesRoles: boolean,
  canManage: (role: RoleRow) => boolean,
): LobbyPeopleView => {
  const held = facts.grants.filter(
    (grant) =>
      grant.scopeKind === 'lobby' &&
      grant.lobbyId === facts.lobby.id &&
      grant.revokedAt === null &&
      (grant.expiresAt === null ||
        Date.parse(grant.expiresAt) > Date.parse(now)),
  );
  return {
    lobbyId: facts.lobby.id,
    version: facts.lobby.version,
    name: facts.lobby.name,
    people: facts.people.flatMap((person) => {
      const owner = person.userId === facts.ownerUserId;
      const grants = held
        .filter((grant) => grant.userId === person.userId)
        .map((grant) => ({
          grantId: grant.id,
          roleId: grant.role.id,
          expiresAt: grant.expiresAt,
          removable: !owner && managesRoles && canManage(grant.role),
        }));
      return owner || grants.length > 0
        ? [
            {
              ...person,
              owner,
              grants,
              removable: grants.some((grant) => grant.removable),
            },
          ]
        : [];
    }),
    roles: facts.roles.map((role) => ({
      roleId: role.id,
      name: role.name,
      rank: role.rank,
      preset: role.preset,
      permissions: [...role.permissions],
      giveable:
        managesRoles &&
        (role.preset ||
          role.organizationId === facts.lobby.ownerOrganizationId) &&
        canManage(role),
    })),
    capabilities: { give: managesRoles },
  };
};

/** The gate and role-specific capabilities share the actual fenced lobby snapshot. */
export const readLobbyPeople =
  (dependencies: {
    readonly store: Pick<TabStore, 'lobbyPeople'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
  }) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
  ): Promise<LobbyPeopleView | null> => {
    if (!idSchema.safeParse(lobbyId).success) return null;
    try {
      return await dependencies.store.lobbyPeople(
        { viewerUserId: principal.userId, lobbyId },
        async (facts) => {
          if (!facts) return null;
          const { authorization } = facts;
          if (!authorization.organization && !facts.ownerActorId) return null;
          const authority = {
            principal,
            resource: hostLobbyResource(
              facts.lobby,
              authorization.organization,
              facts.ownerActorId,
            ),
            context: {
              account: authorization.account,
              grants: authorization.grants,
              now: dependencies.now(),
              roleGiven: null,
            },
          };
          if (
            !dependencies.authorize({
              ...authority,
              capability: 'lobby.host.people.read',
            }).allow
          )
            return null;
          const managesRoles = dependencies.authorize({
            ...authority,
            capability: 'organization.roles.manage',
          }).allow;
          return lobbyPeopleViewSchema.parse(
            lobbyPeopleOf(
              facts,
              authority.context.now,
              managesRoles,
              (role) =>
                dependencies.authorize({
                  ...authority,
                  capability: 'organization.roles.manage',
                  context: {
                    ...authority.context,
                    roleGiven: roleAuthorityOf(role),
                  },
                }).allow,
            ),
          );
        },
      );
    } catch (error) {
      if (error instanceof EventSettingParentsChanged) return null;
      throw error;
    }
  };
