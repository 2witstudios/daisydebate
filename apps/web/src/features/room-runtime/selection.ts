import type { FormatDefinition, RoomConfig, RoomCreate } from '@daisy/protocol';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { IdGenerator } from '@daisy/clock';
import type { RoomCatalogChoice } from '@daisy/protocol';
import type { Store } from './operations';
export async function resolveRoomSelection(
  body: RoomCreate,
  choices: readonly RoomCatalogChoice[],
  store: Store,
  ids: IdGenerator,
) {
  const selection = body.selection;
  let definition: FormatDefinition;
  let config: RoomConfig;
  let formatId: string;
  let formatVersion: number;
  let presetVersion: number | null = null;
  let competitionType: 'casual' | 'practice' | 'ranked';
  if (selection.kind === 'custom') {
    definition = selection.definition;
    config = selection.config;
    formatId = ids.next();
    formatVersion = 1;
    competitionType = selection.competitionType;
  } else {
    const choice = choices.find(
      (choice) =>
        choice.formatId === selection.formatId &&
        choice.formatVersion === selection.formatVersion,
    );
    if (!choice) throw createAppError('VALIDATION');
    definition = choice.definition;
    formatId = choice.formatId;
    formatVersion = choice.formatVersion;
    if (selection.kind === 'ranked') {
      const preset = await rankedPreset(
        store,
        definition,
        formatId,
        formatVersion,
        selection,
      );
      config = preset.config;
      presetVersion = preset.version;
      competitionType = 'ranked';
    } else {
      config = selection.config;
      competitionType = selection.competitionType;
    }
  }
  const resolved = resolveRoomConfiguration(definition, config);
  if (!resolved.ok) throw createAppError('VALIDATION', resolved.refusal.kind);
  return {
    selection,
    definition,
    config,
    formatId,
    formatVersion,
    presetVersion,
    competitionType,
    resolved,
  };
}
const rankedPreset = async (
  store: Store,
  definition: FormatDefinition,
  formatId: string,
  formatVersion: number,
  selection: Extract<RoomCreate['selection'], { kind: 'ranked' }>,
) => {
  const preset = await store.getCurrentPreset(formatId, selection.length);
  if (
    !preset ||
    preset.version !== selection.presetVersion ||
    preset.formatVersion !== formatVersion ||
    definition.seats.affirmative !== 1 ||
    definition.seats.negative !== 1 ||
    definition.seats.judge !== 1
  )
    throw createAppError('VALIDATION');
  return preset;
};
