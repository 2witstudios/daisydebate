import { createRefusal } from '@daisy/errors';
import type { OpeningEffect, RoundProjection } from '@daisy/protocol';
import { bytesOf } from './draw-random';
import { createRoundRuntime } from './round-runtime';
import { revealed } from './resolution-draw';
import {
  projectOpening,
  revealOf,
  settledOpeningTopic,
  settleOpening,
  strikeOpening,
  type OpeningSeat,
  type RoundOpening,
} from './round-opening';

type RuntimeInput = Parameters<typeof createRoundRuntime>[0];

/** A Round in its opening, as the adapter hydrates it under its lock. */
export type OpeningRound = RuntimeInput & {
  readonly opening: RoundOpening;
  readonly seed: string | null;
  readonly now: string;
};

const settled = ({ opening, seed, now }: OpeningRound) =>
  settleOpening(opening, seed === null ? null : bytesOf(seed), now);

/** What moved between the stored opening and the settled one. */
const effectOf = (
  stored: RoundOpening,
  opening: RoundOpening,
  activatedAt: string | null,
): OpeningEffect => {
  const { draw } = opening;
  const added = draw?.strikes.slice(stored.draw?.strikes.length ?? 0) ?? [];
  return {
    strikes:
      draw && added.length > 0
        ? { drawId: draw.id, drawSize: draw.manifest.drawSize, added }
        : null,
    reveal: draw && added.length > 0 && revealed(draw) ? revealOf(draw) : null,
    activatedAt,
  };
};

/**
 * The opening at `now`, from what is stored: due strikes, then activation at
 * the instant the opening ended. The effect carries those instants, so a late
 * sweep cannot move the countdown.
 */
const advanceFrom = (
  stored: RoundOpening,
  input: OpeningRound,
): RoundProjection => {
  const { opening, step } = settled(input);
  const runtime = createRoundRuntime(input);
  const activatedAt = step.step === 'complete' ? step.at : null;
  return {
    ...(activatedAt !== null
      ? runtime.activate({ at: activatedAt, now: input.now })
      : runtime.tick(input.now)),
    openingEffect: effectOf(stored, opening, activatedAt),
  };
};

export const advanceOpening = (input: OpeningRound): RoundProjection =>
  advanceFrom(input.opening, input);

/** A debater's strike on the settled opening; a refusal changes nothing. */
export function strikeInOpening(
  input: OpeningRound & {
    readonly seats: readonly OpeningSeat[];
    readonly strike: {
      readonly actorId: string;
      readonly commandId: string;
      readonly ordinal: number;
      readonly position: number;
    };
  },
): RoundProjection {
  const before = settled(input).opening;
  const outcome = strikeOpening(before, input.seats, {
    ...input.strike,
    now: input.now,
  });
  if (!outcome.ok) throw createRefusal('CONFLICT', outcome.refusal);
  return advanceFrom(input.opening, { ...input, opening: outcome.opening });
}

/**
 * A forfeit in the opening: due steps settle first, then it stands as a result.
 * Past the opening's end but before any sweep, the Round starts at that end and
 * no speech has been played, so no segment opens.
 */
export function forfeitInOpening(
  input: OpeningRound & { readonly actorId: string },
): RoundProjection {
  const { opening, step } = settled(input);
  const activatedAt = step.step === 'complete' ? step.at : null;
  return {
    ...createRoundRuntime(input).execute({
      command: { type: 'forfeit' },
      actorId: input.actorId,
      now: input.now,
    }),
    openingEffect: effectOf(input.opening, opening, activatedAt),
  };
}

/** Whether the Round is in pre-round prep at `now`: every mic and camera closes. */
export const inPreRoundPrep = (input: {
  readonly opening: RoundOpening;
  readonly seed: string | null;
  readonly now: string;
}) =>
  settleOpening(
    input.opening,
    input.seed === null ? null : bytesOf(input.seed),
    input.now,
  ).step.step === 'prep';

/** One viewer's opening for a Round read; every seat counts as eligible to read. */
export const readRoundOpening = (
  opening: { readonly state: RoundOpening; readonly seed: string | null },
  seats: readonly Omit<OpeningSeat, 'eligible'>[],
  viewerActorId: string,
  now: string,
) =>
  projectOpening(
    opening.state,
    opening.seed === null ? null : bytesOf(opening.seed),
    seats.map((seat) => ({ ...seat, eligible: true })),
    viewerActorId,
    now,
  );

/** The settled resolution of a stored opening; null until a draw has narrowed. */
export const readRoundOpeningTopic = (
  opening: { readonly state: RoundOpening; readonly seed: string | null },
  now: string,
) =>
  settledOpeningTopic(
    opening.state,
    opening.seed === null ? null : bytesOf(opening.seed),
    now,
  );
