import { isTwoSided, type FormatDefinition } from '@daisy/protocol';

/**
 * Who strikes first in a Custom room: a two-sided format's second side, as in
 * Daisy's formats. A format of any other shape has no strike.
 */
export const customFirstStriker = (
  sides: FormatDefinition['sides'],
): string | null => (isTwoSided(sides) ? (sides[1]?.key ?? null) : null);

const customStrike = (
  sides: FormatDefinition['sides'],
): FormatDefinition['configurable']['resolutionDraw'] => {
  const firstStriker = customFirstStriker(sides);
  return firstStriker === null
    ? null
    : {
        drawSize: { min: 5, max: 5 },
        strikeWindowMs: { min: 60_000, max: 60_000 },
        firstStrikers: [firstStriker],
        sources: ['bank'],
      };
};

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
      inRoundPrep:
        definition.sides.length > 0
          ? {
              budgetMsPerSide: { min: 0, max: 1_200_000 },
              spendableBefore: ['speech', 'cross_ex'],
              expiresAtSegment: null,
            }
          : null,
      resolutionDraw: customStrike(definition.sides),
      interaction: {
        interruptions: {
          modes: ['disabled', 'enabled', 'open'],
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
