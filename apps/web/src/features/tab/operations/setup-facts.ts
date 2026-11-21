import { ballotPinCompatible } from './ballot-pin-compatible';
import { ballotDefinitionSchema } from '@daisy/protocol';
import type { LoadedSetupCommand } from '@daisy/db/tab';
import {
  enforcedConflict,
  eventChain,
  resolveSetting,
} from '@daisy/protocol/setting-resolution';
import { settingKeys } from '@daisy/protocol/settings';
import type { SetupFacts } from '../commands/setup';
import { settingRow } from './setting-facts';
import { eventSettingChain } from './setting-chains';
import { formatSettingDefaults } from './format-setting-defaults';

export const setupFacts = (
  loaded: LoadedSetupCommand,
  input: {
    readonly now: string;
    readonly newIds: { readonly primary: string; readonly secondary: string };
  },
): SetupFacts => {
  const { graph, lobby } = loaded;
  const rows = graph.settings.map(settingRow);
  const eventRows =
    graph.branches.find((branch) => branch.lobbyId === lobby?.id)?.events ?? [];
  const entries =
    graph.branches.find((branch) => branch.lobbyId === lobby?.id)?.entries ??
    [];
  return {
    ...input,
    lobby: lobby
      ? {
          id: lobby.id,
          kind: lobby.kind,
          closedAt: lobby.closedAt?.toISOString() ?? null,
          version: lobby.version,
        }
      : null,
    events: eventRows.map((event) => {
      const chain = eventSettingChain(graph, event);
      const format = formatSettingDefaults(
        graph,
        event.formatId,
        event.formatVersion,
      );
      const eventEntries = entries.filter(
        (entry) => entry.eventId === event.id,
      );
      return {
        id: event.id,
        name: event.name,
        label: event.label,
        formatId: event.formatId,
        formatVersion: event.formatVersion,
        ballotDefinitionId: event.ballotDefinitionId,
        ballotDefinitionVersion: event.ballotDefinitionVersion,
        templateId: event.templateId,
        version: event.version,
        entryCount: eventEntries.length,
        sanctionCount:
          graph.branches
            .find((branch) => branch.lobbyId === lobby?.id)
            ?.sanctions.filter(
              (row) => row.eventId === event.id && row.status === 'approved',
            ).length ?? 0,
        divisions: resolveSetting(
          'entry.divisions',
          chain,
          rows,
          format,
        ).value.items.map((division) => division.key),
        resolutionMethod: resolveSetting('resolution.rule', chain, rows, format)
          .value.method,
        doubleQualifier: resolveSetting(
          'break.double_qualifier',
          chain,
          rows,
          format,
        ).value.value,
        entrantUserIds: [
          ...new Set(
            loaded.entrants
              .filter((entrant) => entrant.eventId === event.id)
              .flatMap((entrant) =>
                entrant.userId === null ? [] : [entrant.userId],
              ),
          ),
        ],
      };
    }),
    stages: loaded.stages.map((stage) => ({
      id: stage.id,
      eventId: stage.eventId,
      kind: stage.kind,
      sequence: stage.sequence,
      timing: stage.timing,
      version: stage.version,
    })),
    tabRounds: loaded.rounds.map((round) => ({
      id: round.id,
      eventId: round.eventId,
      stageId: round.stageId,
      number: round.number,
      timeSlotId: round.timeSlotId,
      poolResolutionId: round.poolResolutionId,
      resolutionPoolId: round.resolutionPoolId,
      resolutionReleased: round.resolutionReleasedAt !== null,
      version: round.version,
      drawPublished: loaded.draws.some(
        (draw) => draw.tabRoundId === round.id && draw.status === 'published',
      ),
    })),
    timeSlots: loaded.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      startsAt: slot.startsAt.toISOString(),
      version: slot.version,
    })),
    formats: graph.formats
      .filter((row) =>
        graph.presets.some(
          (preset) =>
            preset.formatId === row.formatId &&
            preset.formatVersion === row.version,
        ),
      )
      .filter(
        (row) =>
          row.createdByActorId === loaded.authorization.account?.actorId ||
          (row.createdByActorId === null &&
            (row.organizationId === null ||
              row.organizationId === lobby?.ownerOrganizationId)),
      )
      .map((row) => ({
        formatId: row.formatId,
        formatVersion: row.version,
        definition: row.definition,
      })),
    ballotDefinitions: loaded.ballots.map((row) => ({
      id: row.id,
      lobbyId: row.lobbyId,
      currentVersion: row.currentVersion,
      versions: graph.ballots
        .filter((version) => version.ballotDefinitionId === row.id)
        .flatMap((version) => {
          const parsed = ballotDefinitionSchema.safeParse(version.definition);
          return parsed.success
            ? [{ version: version.version, definition: parsed.data }]
            : [];
        }),
    })),
    templates: graph.templates.map((template) => ({
      id: template.id,
      formatId: template.formatId,
      formatVersion: template.formatVersion,
      ballotDefinitionId: template.ballotDefinitionId,
      ballotDefinitionVersion: template.ballotDefinitionVersion,
      retiredAt: template.retiredAt?.toISOString() ?? null,
      ballotCompatible: ballotPinCompatible(graph, {
        ...template,
        lobbyId: lobby?.id ?? null,
      }),
      conflictsWithChain: settingKeys.some(
        (key) =>
          enforcedConflict(
            key,
            eventChain({
              template,
              leagueId: lobby?.ownerOrganizationId ?? null,
              lobbyId: lobby?.id ?? '',
              eventId: input.newIds.primary,
            }),
            rows,
          ) !== null,
      ),
    })),
    resolutionPools: loaded.pools.map((pool) => ({
      id: pool.id,
      lobbyId: pool.lobbyId,
      resolutions: loaded.resolutions
        .filter((resolution) => resolution.poolId === pool.id)
        .map((resolution) => ({
          id: resolution.id,
          retiredAt: resolution.retiredAt?.toISOString() ?? null,
        })),
    })),
  };
};
