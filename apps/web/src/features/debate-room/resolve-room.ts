import type { Database, NewRoom } from '@daisy/db';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { createAppError, isAppError } from '@daisy/errors';
import type {
  FormatDefinition,
  RoomConfig,
  RoundLength,
} from '@daisy/protocol';

type FormatReader = Pick<
  Database,
  'getFormat' | 'getCurrentPreset' | 'getFormatRevision'
>;

type RoomChoice =
  | {
      readonly competitionType: 'ranked';
      readonly formatId: string;
      readonly length: RoundLength;
    }
  | {
      readonly competitionType: 'casual' | 'practice';
      readonly formatId: string;
      readonly length: RoundLength;
      readonly config: RoomConfig;
    };

type Source = {
  readonly formatVersion: number;
  readonly presetVersion: number | null;
  readonly config: RoomConfig;
  readonly definition: FormatDefinition;
};

const rankedSource = async (
  store: FormatReader,
  choice: Extract<RoomChoice, { competitionType: 'ranked' }>,
): Promise<Source> => {
  const preset = await store.getCurrentPreset(choice.formatId, choice.length);
  if (!preset) throw createAppError('CONFLICT', 'preset-unavailable');
  try {
    return {
      formatVersion: preset.formatVersion,
      presetVersion: preset.version,
      config: preset.config,
      definition: await store.getFormatRevision(
        choice.formatId,
        preset.formatVersion,
      ),
    };
  } catch (error) {
    if (isAppError(error) && error.code === 'INVARIANT')
      throw createAppError('INVARIANT', 'revision-not-found', error);
    throw error;
  }
};

const unrankedSource = async (
  store: FormatReader,
  choice: Extract<RoomChoice, { competitionType: 'casual' | 'practice' }>,
): Promise<Source> => {
  const format = await store.getFormat(choice.formatId);
  if (!format) throw createAppError('NOT_FOUND', 'format-not-found');
  return {
    formatVersion: format.version,
    presetVersion: null,
    config: choice.config,
    definition: format.definition,
  };
};

/** Resolve provenance and rules before a Room is assembled or frozen. */
export async function resolveRoomChoice(
  store: FormatReader,
  choice: RoomChoice,
): Promise<
  Omit<NewRoom, 'id' | 'hostActorId' | 'title' | 'topic' | 'visibility'>
> {
  const source =
    choice.competitionType === 'ranked'
      ? await rankedSource(store, choice)
      : await unrankedSource(store, choice);
  const resolved = resolveRoomConfiguration(source.definition, source.config);
  if (!resolved.ok) throw createAppError('VALIDATION', resolved.refusal.kind);
  return {
    formatId: choice.formatId,
    formatVersion: source.formatVersion,
    presetVersion: source.presetVersion,
    competitionType: choice.competitionType,
    length: choice.length,
    config: source.config,
    executionPlan: resolved.roomPlan,
    rules: resolved.rules,
  };
}
