import type {
  FormatDefinition,
  RoomConfig,
  SegmentType,
} from '@daisy/protocol';
import { oneOnOneRoomConfig } from './reference-formats';
import type { SegmentRow } from './catalog-segments';

/**
 * How catalog entries are built (FMT-2a, FMT-2b): a template's definition
 * and starting config, and the resolution strike a draw format adds.
 */

const minute = 60_000;
const speechBounds = { min: minute, max: 15 * minute };
const crossExBounds = { min: 30_000, max: 5 * minute };

/** Every template grants the same interaction and timing latitude. */
export function templateDefinition({
  seats,
  segments,
  prepBefore,
}: {
  readonly seats: { readonly perSide: number };
  readonly segments: readonly SegmentRow[];
  readonly prepBefore: readonly SegmentType[];
}): FormatDefinition {
  return {
    version: 1,
    seats: { affirmative: seats.perSide, negative: seats.perSide, judge: 1 },
    segments: segments.map(([key, label, type, side, slot, minutes]) => ({
      key,
      label,
      type,
      side,
      slot,
      defaultDurationMs: minutes * minute,
    })),
    configurable: {
      timing: {
        segmentDurationMs: Object.fromEntries(
          segments.map(([key, , type]) => [
            key,
            type === 'speech' ? speechBounds : crossExBounds,
          ]),
        ),
        countdownMs: { min: 0, max: minute },
      },
      // A league with no prep during the round (IPDA) offers none.
      inRoundPrep: prepBefore.length
        ? {
            budgetMsPerSide: { min: 0, max: 15 * minute },
            spendableBefore: [...prepBefore],
            expiresAtSegment: null,
          }
        : null,
      preRoundPrep: { durationMs: { min: 0, max: 60 * minute } },
      resolutionDraw: null,
      interaction: {
        crossExModes: ['ordered', 'free'],
        interruptions: {
          modes: ['disabled', 'cross_ex_only', 'enabled'],
          minRemainingMs: { min: 0, max: 5 * minute },
        },
        yield: {
          enabledChoices: [true, false],
          returnsTimeChoices: [true, false],
        },
      },
    },
  };
}

/** A template's starting config: its league prep and questioning, Daisy's usual floor rules. */
export function templateConfig(
  prepMinutesPerSide: number,
  crossExMode: 'ordered' | 'free',
): RoomConfig {
  return {
    ...oneOnOneRoomConfig,
    inRoundPrep: {
      enabled: true,
      budgetMsPerSide: prepMinutesPerSide * minute,
    },
    crossExamination: { crossExMode },
  };
}

/** The strike latitude a draw format grants (FMT-7): a host may draw 3–7 from either source. */
const drawCapability: NonNullable<
  FormatDefinition['configurable']['resolutionDraw']
> = {
  drawSize: { min: 3, max: 7 },
  strikeWindowMs: { min: 15_000, max: 3 * minute },
  firstStrikers: ['negative', 'affirmative'],
  sources: ['bank', 'host'],
};

export const withDraw = (definition: FormatDefinition): FormatDefinition => ({
  ...definition,
  configurable: { ...definition.configurable, resolutionDraw: drawCapability },
});

/**
 * The IPDA-style strike (IPDA Bylaws Art. 1 F): five bank resolutions of
 * any kind, the Negative strikes first, then fixed prep and none during
 * the round. The 60 s strike window is Daisy's; IPDA leaves it to the room.
 */
export const strikeConfig = (
  base: RoomConfig,
  prepMinutes: number,
): RoomConfig => ({
  ...base,
  preRoundPrep: { enabled: true, durationMs: prepMinutes * minute },
  inRoundPrep: { enabled: false },
  resolutionDraw: {
    enabled: true,
    drawSize: 5,
    strikeWindowMs: minute,
    firstStriker: 'negative',
    source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
  },
});
