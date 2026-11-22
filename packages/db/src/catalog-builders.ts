import { affirmativeSide, negativeSide, twoSides } from '@daisy/protocol/seats';
import {
  type FormatDefinition,
  type SegmentType,
} from '@daisy/protocol/format';
import { type FormatSettings } from '@daisy/protocol/format-settings';
import { oneOnOneSettings } from './reference-formats';
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
    version: 2,
    sides: [...twoSides],
    seats: {
      sides: {
        [affirmativeSide]: seats.perSide,
        [negativeSide]: seats.perSide,
      },
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
    outcome: { kind: 'winner' },
    segments: segments.map(([key, label, type, seat, minutes]) => ({
      key,
      label,
      type,
      // A speech is its speaker's; in cross-ex every debater speaks and the asker leads.
      speak:
        type === 'speech'
          ? { rights: 'one' as const, seat }
          : { rights: 'all' as const, lead: seat },
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
        interruptions: {
          modes: ['disabled', 'enabled'],
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

/** A template's settings: its league prep, Daisy's usual floor rules. */
export function templateSettings(prepMinutesPerSide: number): FormatSettings {
  return {
    ...oneOnOneSettings,
    inRoundPrep: {
      enabled: true,
      budgetMsPerSide: prepMinutesPerSide * minute,
    },
  };
}

/** The strike latitude a draw format grants (FMT-7): a host may draw 3–7 from either source. */
const drawCapability: NonNullable<
  FormatDefinition['configurable']['resolutionDraw']
> = {
  drawSize: { min: 3, max: 7 },
  strikeWindowMs: { min: 15_000, max: 3 * minute },
  firstStrikers: [negativeSide, affirmativeSide],
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
export const strikeSettings = (
  base: FormatSettings,
  prepMinutes: number,
): FormatSettings => ({
  ...base,
  preRoundPrep: { enabled: true, durationMs: prepMinutes * minute },
  inRoundPrep: { enabled: false },
  resolutionDraw: {
    enabled: true,
    drawSize: 5,
    strikeWindowMs: minute,
    firstStriker: negativeSide,
    source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
  },
});
