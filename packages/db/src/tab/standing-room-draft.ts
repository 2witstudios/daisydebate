import { and, eq, isNull } from 'drizzle-orm';
import { lobbies } from '../schema/lobbies';
import { lobbyTemplates } from '../schema/templates';
import { scopeTransaction } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { loadOrganizationContext } from './organization-context';
import { loadSettingGraph } from './setting-graph';
import type { TabDatabase } from './tab-transaction';

export const createStandingRoomDraftStore = (database: TabDatabase) => ({
  standingRoomDraft: (input: {
    readonly viewerUserId: string;
    readonly lobbyId: string;
  }) =>
    database.transaction(async (tx) => {
      await scopeTransaction(tx, { subjectUserId: input.viewerUserId });
      await lockTabCommandAccounts(tx, [input.viewerUserId]);
      const [lobby] = await tx
        .select()
        .from(lobbies)
        .where(
          and(eq(lobbies.id, input.lobbyId), eq(lobbies.kind, 'standing')),
        );
      if (!lobby || !lobby.ownerOrganizationId) return null;
      const scope = {
        subjectUserId: input.viewerUserId,
        organizationId: lobby.ownerOrganizationId,
        lobbyId: lobby.id,
      };
      await scopeTransaction(tx, scope);
      // This named read needs offered definitions and rows, never every tournament's record.
      const graph = await loadSettingGraph(tx, scope, []);
      const offered = await tx
        .select({ templateId: lobbyTemplates.templateId })
        .from(lobbyTemplates)
        .where(
          and(
            eq(lobbyTemplates.lobbyId, lobby.id),
            isNull(lobbyTemplates.withdrawnAt),
          ),
        );
      const offeredIds = new Set(offered.map((row) => row.templateId));
      const organizationIds = [
        ...new Set([
          lobby.ownerOrganizationId,
          ...graph.templates
            .filter((row) => offeredIds.has(row.id))
            .map((row) => row.organizationId),
        ]),
      ].sort();
      const templateAuthorizations = [];
      for (const organizationId of organizationIds) {
        const organizationScope = { ...scope, organizationId };
        await scopeTransaction(tx, organizationScope);
        templateAuthorizations.push({
          organizationId,
          authorization: await loadOrganizationContext(
            tx,
            organizationScope,
            input.viewerUserId,
          ),
        });
      }
      await scopeTransaction(tx, scope);
      const authorization = templateAuthorizations.find(
        (row) => row.organizationId === lobby.ownerOrganizationId,
      )!.authorization;
      const [current] = await tx
        .select()
        .from(lobbies)
        .where(eq(lobbies.id, lobby.id));
      if (!current) return null;
      return {
        lobby: current,
        authorization,
        graph,
        offered,
        templateAuthorizations,
      };
    }),
});
export type StandingRoomDraftFacts = NonNullable<
  Awaited<
    ReturnType<
      ReturnType<typeof createStandingRoomDraftStore>['standingRoomDraft']
    >
  >
>;
