import { asc, eq } from 'drizzle-orm';
import { organizations } from '../schema/organizations';
import { lobbies } from '../schema/lobbies';
import { lobbyTemplates } from '../schema/templates';
import { events, stages, tabRounds } from '../schema/events';
import { entries } from '../schema/entries';
import { sanctions } from '../schema/sanctions';
import { rooms } from '../schema/rooms';
import { ballotDefinitionVersions } from '../schema/ballot-definitions';
import { formatPresets } from '../schema/format-presets';
import { settings } from '../schema/settings';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { loadTemplateRows, loadFormatRows } from './setting-definition-rows';
import type { TabTransaction } from './tab-transaction';

const lobbyGraph = async (tx: TabTransaction, lobbyId: string) => ({
  lobbyId,
  offers: await tx
    .select()
    .from(lobbyTemplates)
    .where(eq(lobbyTemplates.lobbyId, lobbyId)),
  events: await tx.select().from(events).where(eq(events.lobbyId, lobbyId)),
  stages: await tx
    .select({ id: stages.id, eventId: stages.eventId, kind: stages.kind })
    .from(stages)
    .where(eq(stages.lobbyId, lobbyId)),
  rounds: await tx
    .select({
      stageId: tabRounds.stageId,
      eventId: tabRounds.eventId,
      timeSlotId: tabRounds.timeSlotId,
    })
    .from(tabRounds)
    .where(eq(tabRounds.lobbyId, lobbyId)),
  entries: await tx
    .select({
      eventId: entries.eventId,
      division: entries.division,
      status: entries.status,
    })
    .from(entries)
    .where(eq(entries.lobbyId, lobbyId)),
  sanctions: await tx
    .select()
    .from(sanctions)
    .where(eq(sanctions.lobbyId, lobbyId)),
  rooms: await tx
    .select({
      id: rooms.id,
      templateId: rooms.templateId,
      formatId: rooms.formatId,
      formatVersion: rooms.formatVersion,
    })
    .from(rooms)
    .where(eq(rooms.lobbyId, lobbyId)),
});

/**
 * A settings writer must check every chain that consumes the definition,
 * including follows outside the owning organization and withdrawn offers
 * whose existing Rooms still follow. Visit each public lobby identity under
 * its own fence, retaining only the facts needed for those invariants, then
 * restore the command's scope. None of this graph is a viewer projection.
 */
export const loadSettingGraph = async (
  tx: TabTransaction,
  scope: TenantScope,
  lobbyIds?: readonly string[],
) => {
  const lobbyRows = await tx.select().from(lobbies).orderBy(asc(lobbies.id));
  const branches: Awaited<ReturnType<typeof lobbyGraph>>[] = [];
  for (const lobby of lobbyRows.filter(
    (row) => lobbyIds === undefined || lobbyIds.includes(row.id),
  )) {
    await scopeTransaction(tx, {
      subjectUserId: scope.subjectUserId,
      lobbyId: lobby.id,
    });
    branches.push(await lobbyGraph(tx, lobby.id));
  }
  await scopeTransaction(tx, scope);
  return {
    lobbies: lobbyRows,
    organizations: await tx.select().from(organizations),
    branches,
    templates: await loadTemplateRows(tx),
    formats: await loadFormatRows(tx),
    settings: await tx.select().from(settings),
    presets: await tx.select().from(formatPresets),
    ballots: await tx.select().from(ballotDefinitionVersions),
  };
};
export type SettingGraph = Awaited<ReturnType<typeof loadSettingGraph>>;
