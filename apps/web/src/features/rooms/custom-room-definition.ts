import type { FormatDefinition } from '@daisy/protocol';

/** A Custom room owns its definition; its template contributes values, not restrictions. */
export function customRoomDefinition(
  definition: FormatDefinition,
): FormatDefinition {
  return {
    ...definition,
    configurable: {
      timing: {
        segmentDurationMs: Object.fromEntries(
          definition.segments.map((segment) => [
            segment.key,
            { min: 1_000, max: 900_000 },
          ]),
        ),
        countdownMs: { min: 0, max: 60_000 },
      },
      preRoundPrep: { durationMs: { min: 0, max: 7_200_000 } },
      inRoundPrep: {
        budgetMsPerSide: { min: 0, max: 1_200_000 },
        spendableBefore: ['speech', 'cross_ex'],
        expiresAtSegment: null,
      },
      resolutionDraw: {
        drawSize: { min: 5, max: 5 },
        strikeWindowMs: { min: 60_000, max: 60_000 },
        firstStrikers: ['negative'],
        sources: ['bank'],
      },
      interaction: {
        crossExModes: ['ordered', 'free'],
        interruptions: {
          modes: ['disabled', 'cross_ex_only', 'enabled', 'open'],
          minRemainingMs: { min: 0, max: 300_000 },
        },
        yield: {
          enabledChoices: [true, false],
          returnsTimeChoices: [true, false],
        },
      },
    },
  };
}
