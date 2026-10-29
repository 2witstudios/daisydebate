import { formatStanding } from '@daisy/debate-engine';
import {
  formatDefinitionSchema,
  roomConfigSchema,
  type RoomCatalogChoice,
  type RoomConfig,
} from '@daisy/protocol';
import {
  createRoomDraft,
  type CreateRoomDraft,
  type ResolutionMethod,
} from './create-room-draft';
import { clockDuration, readDuration } from './duration-input';
import { customRoomDefinition } from './custom-room-definition';

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
    seatAffirmative: String(definition.seats.affirmative),
    seatNegative: String(definition.seats.negative),
    seatJudge: String(definition.seats.judge),
    segmentCount: String(definition.segments.length),
    ...Object.fromEntries(
      definition.segments.flatMap((segment, index) => [
        [`segment.${index}.key`, segment.key],
        [`segment.${index}.label`, segment.label],
        [`segment.${index}.type`, segment.type],
        [`segment.${index}.side`, segment.side],
        [`segment.${index}.slot`, String(segment.slot)],
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

const strike: RoomConfig['resolutionDraw'] = {
  enabled: true,
  drawSize: 5,
  strikeWindowMs: 60_000,
  firstStriker: 'negative',
  source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
};
const invalid = {
  ok: false,
  error: 'Check the speech order, times and room settings.',
} as const;

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
  if (selected && roomChoiceKey(selected) !== roomChoiceKey(source)) {
    const draft = createRoomDraft(selected);
    return {
      ok: true,
      draft: {
        ...draft,
        ranked: false,
      },
    };
  }
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
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
  const count = Number(values.segmentCount);
  if (!Number.isInteger(count) || count < 1 || count > 64) return invalid;
  const rawSegments = Array.from({ length: count }, (_, index) => {
    const key = values[`segment.${index}.key`] ?? '';
    return {
      key,
      label: values[`segment.${index}.label`],
      type: values[`segment.${index}.type`],
      side: values[`segment.${index}.side`],
      slot: Number(values[`segment.${index}.slot`]),
      defaultDurationMs:
        source.definition.segments.find((segment) => segment.key === key)
          ?.defaultDurationMs ?? duration(`segment.${index}`),
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
    seats: {
      affirmative: Number(values.seatAffirmative),
      negative: Number(values.seatNegative),
      judge: Number(values.seatJudge),
    },
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
  const method = values.resolutionMethod;
  if (!['policy', 'value', 'strike', 'custom'].includes(method ?? ''))
    return invalid;
  const poi = values.questionStyle === 'poi';
  if (!poi && values.questionStyle !== 'cross-examination') return invalid;
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
    resolutionDraw: method === 'strike' ? strike : { enabled: false },
    crossExamination: {
      crossExMode: source.preset.config.crossExamination.crossExMode,
    },
    interruptions: poi
      ? { mode: 'open', minRemainingMs: 0 }
      : source.preset.config.interruptions,
    yielding:
      source.preset.config.yielding === null
        ? null
        : {
            allowed: values.yielding === 'on',
            returnsTime: values.returnsTime === 'on',
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
      definition: custom ? customRoomDefinition(definition) : definition,
      config: parsedConfig.data,
      custom,
      ranked: values.ranked === 'on' && source.preset.rankedEligible && !custom,
      resolutionMethod: method as ResolutionMethod,
      customResolution: values.customResolution ?? '',
    },
  };
}
