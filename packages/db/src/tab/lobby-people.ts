import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { grants } from '../schema/grants';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { users } from '../schema/users';
import { loadLobbyAuthority } from './lobby-authority';
import { loadGrantRows, type GrantRow } from './grant-rows';
import { loadOfferedRoles, type RoleRow } from './role-rows';
import type { TabAuthorization } from './authority-facts';
import type { TabDatabase, TabTransaction } from './tab-transaction';

export type LobbyPeopleFacts = {
  readonly lobby: Pick<
    typeof lobbies.$inferSelect,
    'id' | 'version' | 'name' | 'kind' | 'ownerOrganizationId' | 'ownerUserId'
  >;
  readonly ownerUserId: string | null;
  readonly ownerActorId: string | null;
  readonly people: readonly {
    readonly userId: string;
    readonly name: string;
  }[];
  readonly grants: readonly GrantRow[];
  readonly roles: readonly RoleRow[];
  readonly authorization: TabAuthorization;
  readonly checkedAt: string;
};

/** Exact-lobby recipients under the same account and actual-parent fences as grants. */
async function load(
  tx: TabTransaction,
  input: { readonly viewerUserId: string; readonly lobbyId: string },
): Promise<LobbyPeopleFacts | null> {
  const authority = await loadLobbyAuthority(tx, input);
  if (!authority) return null;
  const { lobby } = authority;
  const [organization] =
    lobby.ownerOrganizationId === null
      ? []
      : await tx
          .select({ ownerUserId: organizations.ownerUserId })
          .from(organizations)
          .where(eq(organizations.id, lobby.ownerOrganizationId));
  const ownerUserId = lobby.ownerUserId ?? organization?.ownerUserId ?? null;
  const recipients = await tx
    .select({ userId: grants.userId })
    .from(grants)
    .where(
      and(
        eq(grants.lobbyId, lobby.id),
        eq(grants.scopeKind, 'lobby'),
        isNull(grants.revokedAt),
      ),
    );
  const ids = [
    ...new Set([
      ...recipients.map((row) => row.userId),
      ...(ownerUserId ? [ownerUserId] : []),
    ]),
  ];
  const people =
    ids.length === 0
      ? []
      : await tx
          .select({ userId: users.id, name: users.username })
          .from(users)
          .where(inArray(users.id, ids))
          .orderBy(asc(users.username), asc(users.id));
  const held = await loadGrantRows(tx, { lobbyId: lobby.id, userIds: ids });
  const offered = await loadOfferedRoles(tx, lobby.ownerOrganizationId);
  const roles = [
    ...new Map(
      [...offered, ...held.map((grant) => grant.role)].map((role) => [
        role.id,
        role,
      ]),
    ).values(),
  ];
  return {
    ...authority,
    ownerUserId,
    people: people.map((person) => ({
      userId: person.userId,
      name: person.name?.trim() ? person.name : 'Former participant',
    })),
    grants: held,
    roles,
  };
}

export const createLobbyPeopleStore = (database: TabDatabase) => ({
  lobbyPeople: <Answer>(
    input: { readonly viewerUserId: string; readonly lobbyId: string },
    work: (facts: LobbyPeopleFacts | null) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => work(await load(tx, input))),
});
