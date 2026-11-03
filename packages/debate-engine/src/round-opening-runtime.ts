import { createRefusal } from '@daisy/errors';
import type { RoundProjection } from '@daisy/protocol';
import { bytesOf } from './draw-random';
import { createRoundRuntime } from './round-runtime';
import {
  projectOpening,
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

const withDraw = (
  projection: RoundProjection,
  opening: RoundOpening,
): RoundProjection =>
  opening.draw ? { ...projection, openingDraw: opening.draw } : projection;

/**
 * The opening at `now`: due strikes, then the Round's start at the instant
 * the opening ended. The projection writes those instants, so a late sweep
 * cannot move the countdown.
 */
export function advanceOpening(input: OpeningRound): RoundProjection {
  const { opening, step } = settled(input);
  const runtime = createRoundRuntime(input);
  return withDraw(
    step.step === 'complete'
      ? {
          ...runtime.activate({ at: step.at, now: input.now }),
          opensAt: step.at,
        }
      : runtime.tick(input.now),
    opening,
  );
}

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
  return advanceOpening({ ...input, opening: outcome.opening });
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
  const runtime = createRoundRuntime(input);
  return withDraw(
    {
      ...runtime.execute({
        command: { type: 'forfeit' },
        actorId: input.actorId,
        now: input.now,
      }),
      ...(step.step === 'complete' ? { opensAt: step.at } : {}),
    },
    opening,
  );
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
