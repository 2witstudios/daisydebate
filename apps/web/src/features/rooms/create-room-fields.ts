import { formatStanding } from '@daisy/debate-engine';
import {
  formatDefinitionSchema,
  roomConfigSchema,
  twoSideKeys,
  type FormatDefinition,
  type RoomCatalogChoice,
  type RoomConfig,
} from '@daisy/protocol';
import {
  createRoomDraft,
  type CreateRoomDraft,
  type ResolutionMethod,
} from './create-room-draft';
import { clockDuration, readDuration } from './duration-input';
import {
  customFirstStriker,
  customRoomDefinition,
} from './custom-room-definition';
import {
  seatFieldValues,
  seatsFromFields,
  segmentSeatValues,
  speakFromFields,
} from './draft-seat-fields';

export const roomChoiceKey = (choice: RoomCatalogChoice) =>
  `${choice.formatId}@${choice.formatVersion}@${choice.preset.version}`;

export function draftFormValues(
  draft: CreateRoomDraft,
): Readonly<Record<string, string>> {
  const { config, definition } = draft;
  return {
    basis: roomChoiceKey(draft.basis),
    format: draft.custom ? 'custom' : draft.basis.formatId,
    template: draft.basis.role === 'template' ? roomChoiceKey(draft.basis) : '',
    resolutionMethod: draft.resolutionMethod,
    customResolution: draft.customResolution,
    ranked: draft.ranked ? 'on' : '',
    'duration.preRound': clockDuration(
      config.preRoundPrep.enabled ? config.preRoundPrep.durationMs : 0,
    ),
    'duration.inRound': clockDuration(
      config.inRoundPrep.enabled ? config.inRoundPrep.budgetMsPerSide : 0,
    ),
    'duration.countdown': clockDuration(config.speechTiming.countdownMs),
    questionStyle:
      config.interruptions?.mode === 'open' ? 'poi' : 'cross-examination',
    yielding: config.yielding?.allowed ? 'on' : 'off',
    returnsTime: config.yielding?.returnsTime ? 'on' : 'off',
    ...seatFieldValues(definition),
    segmentCount: String(definition.segments.length),
    ...Object.fromEntries(
      definition.segments.flatMap((segment, index) => [
        [`segment.${index}.key`, segment.key],
        [`segment.${index}.label`, segment.label],
        [`segment.${index}.type`, segment.type],
        [`segment.${index}.side`, segmentSeatValues(segment.speak).side],
        [`segment.${index}.slot`, segmentSeatValues(segment.speak).slot],
        [
          `duration.segment.${index}`,
          clockDuration(
            config.speechTiming.segmentDurationOverrides[segment.key] ??
              segment.defaultDurationMs,
          ),
        ],
      ]),
    ),
  };
}

/** The strike a drafted room runs: Daisy's bank, first struck as a Custom room's is. */
const strikeFor = (
  definition: Pick<FormatDefinition, 'sides'>,
): RoomConfig['resolutionDraw'] | null => {
  const striker = customFirstStriker(definition.sides);
  // The strike is a pair's: its striker is one of the two-sided preset's keys.
  const firstStriker = twoSideKeys.find((key) => key === striker);
  return firstStriker === undefined
    ? null
    : {
        enabled: true,
        drawSize: 5,
        strikeWindowMs: 60_000,
        firstStriker,
        source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
      };
};
const invalid = {
  ok: false,
  error: 'Check the speech order, times and room settings.',
} as const;

/**
 * A Custom room's definition offers interruptions and yielding (see
 * customRoomDefinition); where the draft's choice is none (a template that
 * forbade it, such as Tab's Open conversation), the room forbids it too, so
 * the template's settings commit exactly as chosen.
 */
const forbidUnchosen = (
  definition: FormatDefinition,
  config: RoomConfig,
): FormatDefinition => ({
  ...definition,
  configurable: {
    ...definition.configurable,
    interaction: {
      interruptions:
        config.interruptions === null
          ? null
          : definition.configurable.interaction.interruptions,
      yield:
        config.yielding === null
          ? null
          : definition.configurable.interaction.yield,
    },
  },
});

/** The enhanced editor and native POST decode the same named fields. */
export function readRoomDraft(
  values: Readonly<Record<string, string>>,
  choices: readonly RoomCatalogChoice[],
): { readonly ok: true; readonly draft: CreateRoomDraft } | typeof invalid {
  const source = choices.find(
    (choice) => roomChoiceKey(choice) === values.basis,
  );
  if (!source) return invalid;
  const selected =
    values.format === 'custom'
      ? choices.find(
          (choice) =>
            choice.role === 'template' &&
            values.template &&
            roomChoiceKey(choice) === values.template,
        )
      : choices.find(
          (choice) =>
            choice.role === 'standard' && choice.formatId === values.format,
        );
  const resetSelectedPreset =
    selected &&
    (roomChoiceKey(selected) !== roomChoiceKey(source) ||
      (values.intent === 'format' && selected.role === 'standard') ||
      (values.intent === 'template' && selected.role === 'template'));
  if (selected && resetSelectedPreset) {
    const draft = createRoomDraft(selected);
    return {
      ok: true,
      draft: {
        ...draft,
        ranked: false,
      },
    };
  }
  // The redesigned editor renders settings fields only for Custom, so a
  // submission can post without them in two ways: a standard or template
  // creates at its catalog preset, and a Custom just applied over one
  // starts at that preset's settings. Fields that are present stay
  // authoritative.
  const decoded = { ...draftFormValues(createRoomDraft(source)), ...values };
  const form = new FormData();
  Object.entries(decoded).forEach(([key, value]) => form.set(key, value));
  const duration = (name: string) => readDuration(form, name);
  const before = duration('preRound'),
    during = duration('inRound'),
    countdown = duration('countdown');
  if (
    ![before, during, countdown].every(
      (ms) => Number.isSafeInteger(ms) && ms >= 0,
    )
  )
    return invalid;
  const count = Number(decoded.segmentCount);
  if (!Number.isInteger(count) || count < 1 || count > 64) return invalid;
  const rawSegments = Array.from({ length: count }, (_, index) => {
    const key = decoded[`segment.${index}.key`] ?? '';
    const type = decoded[`segment.${index}.type`] ?? '';
    const sourceSegment = source.definition.segments.find(
      (segment) => segment.key === key,
    );
    return {
      key,
      label: decoded[`segment.${index}.label`],
      type,
      speak: speakFromFields(
        {
          type,
          side: decoded[`segment.${index}.side`] ?? '',
          slot: Number(decoded[`segment.${index}.slot`]),
        },
        sourceSegment,
      ),
      defaultDurationMs:
        sourceSegment?.defaultDurationMs ?? duration(`segment.${index}`),
    };
  });
  const timing = Object.fromEntries(
    rawSegments.map((segment) => [
      segment.key,
      source.definition.configurable.timing.segmentDurationMs[segment.key] ?? {
        min: 1_000,
        max: 900_000,
      },
    ]),
  );
  const parsedDefinition = formatDefinitionSchema.safeParse({
    ...source.definition,
    configurable: {
      ...source.definition.configurable,
      timing: {
        ...source.definition.configurable.timing,
        segmentDurationMs: timing,
      },
      inRoundPrep: source.definition.configurable.inRoundPrep && {
        ...source.definition.configurable.inRoundPrep,
        expiresAtSegment: rawSegments.some(
          (segment) =>
            segment.key ===
            source.definition.configurable.inRoundPrep?.expiresAtSegment,
        )
          ? source.definition.configurable.inRoundPrep.expiresAtSegment
          : null,
      },
    },
    seats: seatsFromFields(decoded, source.definition.sides),
    segments: rawSegments,
  });
  if (!parsedDefinition.success) return invalid;
  const definition = parsedDefinition.data;
  const overrides = Object.fromEntries(
    definition.segments.flatMap((segment, index) => {
      const ms = duration(`segment.${index}`);
      return ms === segment.defaultDurationMs ? [] : [[segment.key, ms]];
    }),
  );
  const method = decoded.resolutionMethod;
  if (!['strike', 'custom'].includes(method ?? '')) return invalid;
  const strike = strikeFor(source.definition);
  if (method === 'strike' && strike === null) return invalid;
  const poi = decoded.questionStyle === 'poi';
  if (!poi && decoded.questionStyle !== 'cross-examination') return invalid;
  const parsedConfig = roomConfigSchema.safeParse({
    ...source.preset.config,
    preRoundPrep:
      before > 0 ? { enabled: true, durationMs: before } : { enabled: false },
    inRoundPrep:
      during > 0 ||
      (source.preset.config.inRoundPrep.enabled &&
        source.preset.config.inRoundPrep.budgetMsPerSide === 0)
        ? { enabled: true, budgetMsPerSide: during }
        : { enabled: false },
    speechTiming: {
      countdownMs: countdown,
      segmentDurationOverrides: overrides,
    },
    resolutionDraw: method === 'strike' && strike ? strike : { enabled: false },
    interruptions: poi
      ? { mode: 'open', minRemainingMs: 0 }
      : source.preset.config.interruptions,
    yielding:
      source.preset.config.yielding === null &&
      decoded.yielding !== 'on' &&
      decoded.returnsTime !== 'on'
        ? null
        : {
            allowed: decoded.yielding === 'on',
            returnsTime: decoded.returnsTime === 'on',
          },
  });
  if (!parsedConfig.success) return invalid;
  const original = createRoomDraft(source);
  const custom =
    values.format === 'custom' ||
    source.role !== 'standard' ||
    method !== original.resolutionMethod ||
    formatStanding({
      active: {
        formatId: source.formatId,
        formatVersion: source.formatVersion,
        definition,
        config: parsedConfig.data,
      },
      basis: {
        formatId: source.formatId,
        formatVersion: source.formatVersion,
        presetVersion: source.preset.version,
        role: source.role,
        definition: source.definition,
        config: source.preset.config,
      },
    }).kind !== 'standard';
  return {
    ok: true,
    draft: {
      ...original,
      definition: custom
        ? forbidUnchosen(customRoomDefinition(definition), parsedConfig.data)
        : definition,
      config: parsedConfig.data,
      custom,
      ranked:
        decoded.ranked === 'on' && source.preset.rankedEligible && !custom,
      resolutionMethod: method as ResolutionMethod,
      customResolution: values.customResolution ?? '',
    },
  };
}
