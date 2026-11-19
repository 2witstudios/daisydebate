import { createAppError } from '@daisy/errors';
import type { SettingGraph } from '@daisy/db/tab';
import {
  eventChain,
  type SettingChain,
} from '@daisy/protocol/setting-resolution';
import type { SettingScope } from '@daisy/protocol/settings';
import type { EventFact, ReachedChain } from '../commands/settings';
import { formatSettingDefaults } from './format-setting-defaults';

type Event = SettingGraph['branches'][number]['events'][number];
type Template = SettingGraph['templates'][number];
const unique = (chain: SettingChain): SettingChain =>
  chain.filter(
    (scope, i) =>
      chain.findIndex(
        (other) => other.kind === scope.kind && other.id === scope.id,
      ) === i,
  );
const templateChain = (template: Template): SettingChain => [
  { kind: 'organization', id: template.organizationId },
  { kind: 'template', id: template.id },
];
export const eventSettingChain = (
  graph: SettingGraph,
  event: Event,
): SettingChain => {
  const template = graph.templates.find((row) => row.id === event.templateId);
  return eventChain({
    template: template ?? null,
    leagueId:
      graph.lobbies.find((row) => row.id === event.lobbyId)
        ?.ownerOrganizationId ?? null,
    lobbyId: event.lobbyId,
    eventId: event.id,
  });
};
const pins = (row: {
  readonly formatId: string;
  readonly formatVersion: number;
  readonly ballotDefinitionId: string | null;
  readonly ballotDefinitionVersion: number | null;
}) => ({
  formatVersionId: `${row.formatId}:${row.formatVersion}`,
  ballotDefinitionVersionId:
    row.ballotDefinitionId === null
      ? 'daisy'
      : `${row.ballotDefinitionId}:${row.ballotDefinitionVersion}`,
});
const sharesBreakSlot = (graph: SettingGraph, event: Event): boolean => {
  const branch = graph.branches.find((row) => row.lobbyId === event.lobbyId);
  const rounds =
    branch?.rounds.filter(
      (round) =>
        round.eventId === event.id &&
        round.timeSlotId !== null &&
        branch.stages.some(
          (stage) => stage.id === round.stageId && stage.kind === 'elimination',
        ),
    ) ?? [];
  return rounds.some((round, i) =>
    rounds.some(
      (other, j) =>
        j > i &&
        other.stageId !== round.stageId &&
        other.timeSlotId === round.timeSlotId,
    ),
  );
};
const eventHoldings = (
  graph: SettingGraph,
  event: Event,
): readonly Pick<
  EventFact,
  'divisionsInUse' | 'breaksShareSlot' | 'sanction'
>[] => {
  const branch = graph.branches.find((row) => row.lobbyId === event.lobbyId);
  const common = {
    divisionsInUse: [
      ...new Set(
        branch?.entries
          .filter(
            (entry) =>
              entry.eventId === event.id && entry.status !== 'withdrawn',
          )
          .flatMap((entry) =>
            entry.division === null ? [] : [entry.division],
          ) ?? [],
      ),
    ],
    breaksShareSlot: sharesBreakSlot(graph, event),
  };
  const approved =
    branch?.sanctions.filter(
      (row) => row.eventId === event.id && row.status === 'approved',
    ) ?? [];
  if (approved.length === 0) return [{ ...common, sanction: null }];
  return approved.map((sanction) => {
    const template = graph.templates.find(
      (row) => row.id === sanction.templateId,
    );
    if (!template)
      throw createAppError('INVARIANT', 'Sanction template is missing');
    return {
      ...common,
      sanction: {
        templateChain: templateChain(template),
        template: pins(template),
        event: pins(event),
      },
    };
  });
};
export const settingEventFact = (
  graph: SettingGraph,
  event: Event,
): EventFact => {
  const template = graph.templates.find((row) => row.id === event.templateId);
  const holding = eventHoldings(graph, event)[0]!;
  return {
    ...holding,
    id: event.id,
    lobbyId: event.lobbyId,
    leagueId:
      graph.lobbies.find((row) => row.id === event.lobbyId)
        ?.ownerOrganizationId ?? null,
    templateId: event.templateId,
    templateOrganizationId: template?.organizationId ?? null,
    version: event.version,
    settingsVersion: event.settingsVersion,
    entryCount:
      graph.branches
        .find((row) => row.lobbyId === event.lobbyId)
        ?.entries.filter((entry) => entry.eventId === event.id).length ?? 0,
    format: formatSettingDefaults(graph, event.formatId, event.formatVersion),
  };
};

/** All consumers, including every sanction of an event, must survive the write. */
export const reachedSettingChains = (
  graph: SettingGraph,
  scope: SettingScope | null,
): readonly ReachedChain[] => {
  if (scope === null) return [];
  type Consumer = {
    readonly chain: SettingChain;
    readonly pin: {
      readonly formatId: string;
      readonly formatVersion: number;
    } | null;
    readonly event: ReachedChain['event'];
  };
  const chains: Consumer[] = graph.organizations.map((row) => ({
    chain: [{ kind: 'organization', id: row.id }],
    pin: null,
    event: null,
  }));
  for (const template of graph.templates)
    chains.push({
      chain: templateChain(template),
      pin: template,
      event: null,
    });
  for (const lobby of graph.lobbies) {
    const branch = graph.branches.find((row) => row.lobbyId === lobby.id);
    if (lobby.kind === 'tournament') {
      chains.push({
        chain: [
          ...(lobby.ownerOrganizationId
            ? [{ kind: 'organization' as const, id: lobby.ownerOrganizationId }]
            : []),
          { kind: 'lobby', id: lobby.id },
        ],
        pin: null,
        event: null,
      });
      for (const event of branch?.events ?? [])
        for (const holding of eventHoldings(graph, event))
          chains.push({
            chain: eventSettingChain(graph, event),
            pin: event,
            event: holding,
          });
      continue;
    }
    const organization: SettingChain = lobby.ownerOrganizationId
      ? [{ kind: 'organization', id: lobby.ownerOrganizationId }]
      : [];
    chains.push({
      chain: [...organization, { kind: 'lobby', id: lobby.id }],
      pin: null,
      event: null,
    });
    const templateIds = [
      ...new Set([
        ...(branch?.offers
          .filter((offer) => offer.withdrawnAt === null)
          .map((offer) => offer.templateId) ?? []),
        ...(branch?.rooms.flatMap((room) =>
          room.templateId === null ? [] : [room.templateId],
        ) ?? []),
      ]),
    ];
    for (const template of graph.templates.filter((row) =>
      templateIds.includes(row.id),
    ))
      chains.push({
        chain: unique([
          ...templateChain(template),
          ...organization,
          { kind: 'lobby', id: lobby.id },
        ]),
        pin: template,
        event: null,
      });
  }
  return chains
    .filter(({ chain }) =>
      chain.some((at) => at.kind === scope.kind && at.id === scope.id),
    )
    .map(({ chain, pin, event }) => ({
      chain,
      event,
      format:
        pin === null
          ? null
          : formatSettingDefaults(graph, pin.formatId, pin.formatVersion),
    }));
};
