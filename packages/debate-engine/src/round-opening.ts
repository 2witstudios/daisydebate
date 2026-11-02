import type { DebateRole, RoundView } from '@daisy/protocol';
import type {
  ResolutionDrawState,
  RoundOpening,
} from '@daisy/protocol/resolution-draw';
export type { RoundOpening };
import {
  revealed,
  settleDraw,
  standingPositions,
  survivorOf,
  turnOf,
} from './resolution-draw';

export type OpeningStep =
  | {
      readonly step: 'strike';
      readonly turn: NonNullable<ReturnType<typeof turnOf>>;
    }
  | {
      readonly step: 'prep';
      readonly startedAt: string;
      readonly endsAt: string;
    }
  | { readonly step: 'complete'; readonly at: string };

/** Where the opening stands as stored, before any time has been settled. */
export function openingStep(opening: RoundOpening): OpeningStep {
  const { draw, prepMs, startedAt } = opening;
  const turn = draw && turnOf(draw);
  if (turn) return { step: 'strike', turn };
  const anchor = (draw && survivorOf(draw)?.at) ?? startedAt;
  return prepMs === null
    ? { step: 'complete', at: anchor }
    : {
        step: 'prep',
        startedAt: anchor,
        endsAt: new Date(Date.parse(anchor) + prepMs).toISOString(),
      };
}

/**
 * The opening at `now`. Every strike is stamped with its own due instant and
 * completion with the instant prep ended, never the processing time, so a
 * late sweep cannot move the countdown. An automatic side's strike needs the
 * seed; a human time-out does not.
 */
export function settleOpening(
  opening: RoundOpening,
  seed: Uint8Array | null,
  now: string,
): { readonly opening: RoundOpening; readonly step: OpeningStep } {
  const settled = opening.draw
    ? { ...opening, draw: settleDraw(opening.draw, seed, now) }
    : opening;
  const step = openingStep(settled);
  return {
    opening: settled,
    step:
      step.step === 'prep' && Date.parse(now) >= Date.parse(step.endsAt)
        ? { step: 'complete', at: step.endsAt }
        : step,
  };
}

/** A seat as the opening reads it. */
export type OpeningSeat = {
  readonly actorId: string;
  readonly role: DebateRole;
  readonly kind: 'human' | 'bot';
  readonly eligible: boolean;
};

const mayStrike = (
  step: OpeningStep,
  seats: readonly OpeningSeat[],
  actorId: string,
) =>
  step.step === 'strike' &&
  !step.turn.automatic &&
  seats.some(
    (seat) =>
      seat.actorId === actorId &&
      seat.role === step.turn.side &&
      seat.kind === 'human' &&
      seat.eligible,
  );

export type StrikeRefusal =
  | 'not-seated'
  | 'strike-conflict'
  | 'strike-unavailable'
  | 'not-your-turn';

/**
 * A debater's strike on the settled opening. The ordinal names the turn the
 * form meant to take, so a stale form conflicts instead of striking twice.
 */
export function strikeOpening(
  opening: RoundOpening,
  seats: readonly OpeningSeat[],
  strike: {
    readonly actorId: string;
    readonly commandId: string;
    readonly ordinal: number;
    readonly position: number;
    readonly now: string;
  },
):
  | { readonly ok: true; readonly opening: RoundOpening }
  | { readonly ok: false; readonly refusal: StrikeRefusal } {
  const refuse = (refusal: StrikeRefusal) => ({ ok: false as const, refusal });
  const { actorId } = strike;
  const debater = seats.some(
    (seat) =>
      seat.actorId === actorId &&
      (seat.role === 'affirmative' || seat.role === 'negative'),
  );
  if (!debater) return refuse('not-seated');
  const { draw } = opening;
  if (!draw) return refuse('strike-unavailable');
  if (revealed(draw) || strike.ordinal !== draw.strikes.length)
    return refuse('strike-conflict');
  const step = openingStep(opening);
  if (step.step !== 'strike' || !mayStrike(step, seats, actorId))
    return refuse('not-your-turn');
  if (!standingPositions(draw).includes(strike.position))
    return refuse('strike-unavailable');
  return {
    ok: true,
    opening: {
      ...opening,
      draw: {
        ...draw,
        strikes: [
          ...draw.strikes,
          {
            ordinal: strike.ordinal,
            position: strike.position,
            side: step.turn.side,
            kind: 'debater',
            actorId,
            commandId: strike.commandId,
            at: strike.now,
          },
        ],
      },
    },
  };
}

type OpeningView = NonNullable<RoundView['opening']>;

/** Seated debaters see every drawn text; everyone else sees progress only. */
const projectDraw = (
  draw: ResolutionDrawState,
  debater: boolean,
  actorId: string | null,
  now: string,
): NonNullable<OpeningView['draw']> => {
  const open = turnOf(draw);
  const turn = open && {
    ordinal: open.ordinal,
    side: open.side,
    dueAt: open.dueAt,
    remainingMs: Math.max(0, Date.parse(open.dueAt) - Date.parse(now)),
  };
  const revealedAt = survivorOf(draw)?.at ?? null;
  if (!debater)
    return {
      visibility: 'progress',
      drawSize: draw.manifest.drawSize,
      strikes: draw.strikes.map(({ ordinal, side, kind }) => ({
        ordinal,
        side,
        kind,
      })),
      turn,
      revealedAt,
    };
  return {
    visibility: 'debater',
    commitment: draw.commitment,
    drawSize: draw.manifest.drawSize,
    items: draw.items.map(({ position, text, category }) => ({
      position,
      text,
      category,
    })),
    strikes: draw.strikes.map(
      ({ ordinal, side, kind, position, actorId: by }) => ({
        ordinal,
        side,
        kind,
        position,
        byViewer: by === actorId,
      }),
    ),
    turn,
    revealedAt,
  };
};

/**
 * One viewer's opening at `now`, settled without writing. Every field is
 * built explicitly so a draw text, the seed or a private input cannot ride
 * along. The survivor reaches everyone as the topic, only once revealed.
 */
export function projectOpening(
  stored: RoundOpening,
  seed: Uint8Array | null,
  seats: readonly OpeningSeat[],
  viewerActorId: string | null,
  now: string,
): { readonly view: OpeningView; readonly topic: string | null } {
  const { opening, step } = settleOpening(stored, seed, now);
  const debater = seats.some(
    (seat) =>
      seat.actorId === viewerActorId &&
      (seat.role === 'affirmative' || seat.role === 'negative'),
  );
  const draw = opening.draw;
  return {
    topic: (draw && survivorOf(draw)?.item.text) ?? null,
    view: {
      step:
        step.step === 'strike'
          ? { step: 'strike' }
          : step.step === 'prep'
            ? {
                ...step,
                remainingMs: Math.max(
                  0,
                  Date.parse(step.endsAt) - Date.parse(now),
                ),
              }
            : step,
      draw: draw && projectDraw(draw, debater, viewerActorId, now),
      canStrike:
        viewerActorId !== null && mayStrike(step, seats, viewerActorId),
    },
  };
}
