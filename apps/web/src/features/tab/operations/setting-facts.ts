import type { LoadedSettingCommand, SettingGraph } from '@daisy/db/tab';
import type { SettingCommand } from '@daisy/protocol/lobby/setting-command';
import {
  settingRowSchema,
  type SettingRow,
  type SettingScope,
} from '@daisy/protocol/settings';
import type { SettingFacts, TemplateRow } from '../commands/settings';
import { formatSettingDefaults } from './format-setting-defaults';
import { reachedSettingChains, settingEventFact } from './setting-chains';

type StoredSetting = SettingGraph['settings'][number];
export const settingRow = (row: StoredSetting): SettingRow => {
  const id = {
    organization: row.organizationId,
    template: row.templateId,
    lobby: row.lobbyId,
    event: row.eventId,
  }[row.scopeKind];
  return settingRowSchema.parse({
    scope: { kind: row.scopeKind, id },
    key: row.key,
    hold: row.hold,
    value: row.value,
  }) as SettingRow;
};
export const templateFact = (
  graph: SettingGraph,
  row: SettingGraph['templates'][number],
): TemplateRow => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  formatId: row.formatId,
  formatVersion: row.formatVersion,
  ballotDefinitionId: row.ballotDefinitionId,
  ballotDefinitionVersion: row.ballotDefinitionVersion,
  retiredAt: row.retiredAt?.toISOString() ?? null,
  version: row.version,
  format: formatSettingDefaults(graph, row.formatId, row.formatVersion),
});
const scopeFact = (
  loaded: LoadedSettingCommand,
  scope: SettingScope,
): SettingFacts['scope'] => {
  const { graph, named } = loaded;
  switch (scope.kind) {
    case 'organization': {
      const row = graph.organizations.find((row) => row.id === scope.id);
      return row
        ? {
            kind: 'organization',
            id: scope.id,
            settingsVersion: row.settingsVersion,
          }
        : null;
    }
    case 'template':
      return named.template
        ? {
            kind: 'template',
            id: scope.id,
            organizationId: named.template.organizationId,
            settingsVersion: named.template.settingsVersion,
          }
        : null;
    case 'lobby':
      return named.lobby
        ? {
            kind: 'lobby',
            id: scope.id,
            settingsVersion: named.lobby.settingsVersion,
          }
        : null;
    case 'event':
      return named.event
        ? {
            kind: 'event',
            id: scope.id,
            lobbyId: named.event.lobbyId,
            settingsVersion: named.event.settingsVersion,
          }
        : null;
  }
};

export const settingFacts = (
  loaded: LoadedSettingCommand,
  command: SettingCommand,
  input: { readonly now: string; readonly newId: string },
): SettingFacts => {
  const { graph, named } = loaded;
  const scope =
    command.type === 'set-setting' || command.type === 'clear-setting'
      ? command.scope
      : null;
  const template = named.template ? templateFact(graph, named.template) : null;
  const event = named.event ? settingEventFact(graph, named.event) : null;
  const pin = command.type === 'create-template' ? command.format : null;
  const format = graph.formats.find(
    (row) =>
      row.formatId === pin?.id &&
      row.version === pin.version &&
      row.createdByActorId === null &&
      graph.presets.some(
        (preset) =>
          preset.formatId === row.formatId &&
          preset.formatVersion === row.version,
      ),
  );
  const ballotPin =
    command.type === 'create-template' ? command.ballotDefinition : null;
  const ballot = graph.ballots.find(
    (row) =>
      row.ballotDefinitionId === ballotPin?.id &&
      row.version === ballotPin.version,
  );
  const offered = graph.branches
    .find((row) => row.lobbyId === named.lobby?.id)
    ?.offers.find((row) => row.templateId === named.template?.id);
  const name = 'name' in command ? command.name.toLowerCase() : null;
  const organizationId =
    command.type === 'create-template'
      ? command.organizationId
      : named.template?.organizationId;
  return {
    ...input,
    rows: graph.settings.map(settingRow),
    scope: scope === null ? null : scopeFact(loaded, scope),
    reached: reachedSettingChains(graph, scope),
    ownFormat: template?.format ?? event?.format ?? null,
    template,
    event,
    lobby: named.lobby
      ? {
          id: named.lobby.id,
          kind: named.lobby.kind,
          ownerOrganizationId: named.lobby.ownerOrganizationId,
          version: named.lobby.version,
        }
      : null,
    offer: offered
      ? { withdrawnAt: offered.withdrawnAt?.toISOString() ?? null }
      : null,
    nameTaken:
      name !== null &&
      graph.templates.some(
        (row) =>
          row.organizationId === organizationId &&
          row.id !== named.template?.id &&
          row.name.toLowerCase() === name,
      ),
    formatRevision: format ? { organizationId: format.organizationId } : null,
    ballotDefinition: ballot
      ? { organizationId: ballot.organizationId, lobbyId: ballot.lobbyId }
      : null,
  };
};
