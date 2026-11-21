import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { LobbyAgeRule } from '@daisy/protocol/lobby/eligibility';
import { grants } from '../schema/grants';
import { scopeTransaction } from '../tenant-scope';
import { ladders } from '../schema/ladders';
import { lobbies } from '../schema/lobbies';
import { organizations } from '../schema/organizations';
import { seasons } from '../schema/seasons';
import { loadAuthorityContext } from './authority-context';
import { fenceOrganizationRead } from './organization-fence';
import type { TabDatabase, TabTransaction } from './tab-transaction';

async function loadStandingLobbies(tx: TabTransaction, organizationId: string) {
  const lobbyRows = await tx
    .select({
      id: lobbies.id,
      name: lobbies.name,
      handle: lobbies.handle,
      ageRule: sql<LobbyAgeRule>`${lobbies.ageRule}`,
      version: lobbies.version,
    })
    .from(lobbies)
    .where(
      and(
        eq(lobbies.kind, 'standing'),
        eq(lobbies.ownerOrganizationId, organizationId),
        isNull(lobbies.closedAt),
      ),
    )
    .orderBy(asc(lobbies.createdAt), asc(lobbies.id));
  const ladderRows = await tx
    .select({ id: ladders.id, lobbyId: ladders.lobbyId, name: ladders.name })
    .from(ladders)
    .where(eq(ladders.organizationId, organizationId))
    .orderBy(asc(ladders.createdAt), asc(ladders.id));
  const seasonRows = await tx
    .select({
      id: seasons.id,
      lobbyId: seasons.lobbyId,
      name: seasons.name,
      status: seasons.status,
      startsAt: seasons.startsAt,
      endsAt: seasons.endsAt,
      version: seasons.version,
    })
    .from(seasons)
    .where(eq(seasons.organizationId, organizationId))
    .orderBy(desc(seasons.startsAt), asc(seasons.id));
  return lobbyRows.map((lobby) => ({
    ...lobby,
    ladders: ladderRows.filter(({ lobbyId }) => lobbyId === lobby.id),
    seasons: seasonRows.filter(({ lobbyId }) => lobbyId === lobby.id),
  }));
}

export const createStandingLobbyManagementStore = (database: TabDatabase) => ({
  hostedLeagueCandidates: (viewerUserId: string) =>
    database.transaction(async (tx) => {
      await scopeTransaction(tx, { subjectUserId: viewerUserId });
      const assigned = tx
        .select({ id: grants.organizationId })
        .from(grants)
        .where(and(eq(grants.userId, viewerUserId), isNull(grants.revokedAt)));
      return tx
        .select({
          id: organizations.id,
          handle: organizations.handle,
          name: organizations.name,
        })
        .from(organizations)
        .where(
          and(
            eq(organizations.kind, 'league'),
            isNull(organizations.closedAt),
            or(
              eq(organizations.ownerUserId, viewerUserId),
              inArray(organizations.id, assigned),
            ),
          ),
        )
        .orderBy(asc(organizations.name), asc(organizations.id));
    }),
  standingLobbyManagement: <Answer>(
    input: { readonly viewerUserId: string; readonly organizationId: string },
    work: (
      facts: {
        readonly authority: Awaited<ReturnType<typeof loadAuthorityContext>>;
        readonly name: string;
      } | null,
      read: () => ReturnType<typeof loadStandingLobbies>,
    ) => Promise<Answer>,
  ) =>
    database.transaction(async (tx) => {
      const scope = await fenceOrganizationRead(tx, input);
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, input.organizationId),
            isNull(organizations.closedAt),
          ),
        );
      const authority = await loadAuthorityContext(
        tx,
        scope,
        input.viewerUserId,
        null,
      );
      return work(
        organization ? { authority, name: organization.name } : null,
        () => loadStandingLobbies(tx, input.organizationId),
      );
    }),
});
