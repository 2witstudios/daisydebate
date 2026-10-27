import type { DrawBankSnapshot, RoomAssemblyState } from '@daisy/protocol';
import { revealed, turnOf } from './resolution-draw';

export const prepFinished = (room: RoomAssemblyState, now: string) =>
  !room.executionPlan.preRoundPrep.enabled ||
  (room.prepStartedAt !== null &&
    room.prepRemainingMs !== null &&
    Date.parse(room.prepStartedAt) + room.prepRemainingMs <= Date.parse(now));

/** Edits freeze exactly once a draw or prep has begun. */
export const preRoundBegun = (room: RoomAssemblyState) =>
  room.resolutionDraw !== null || room.prepStartedAt !== null;

export const needsStart = (room: RoomAssemblyState) =>
  room.executionPlan.resolutionDraw.enabled ||
  room.executionPlan.preRoundPrep.enabled;

export type PreRoundPhase =
  | { readonly phase: 'not-begun' }
  | {
      readonly phase: 'striking';
      readonly turn: NonNullable<ReturnType<typeof turnOf>>;
    }
  | { readonly phase: 'prepping' }
  | { readonly phase: 'satisfied' };

/**
 * Where the pre-round stands for an already settled Room, the same for
 * every viewer. A Room with neither a draw nor prep is satisfied at once.
 */
export function preRoundPhase(
  room: RoomAssemblyState,
  now: string,
): PreRoundPhase {
  if (!preRoundBegun(room))
    return needsStart(room) ? { phase: 'not-begun' } : { phase: 'satisfied' };
  const draw = room.resolutionDraw;
  if (draw && !revealed(draw))
    return { phase: 'striking', turn: turnOf(draw)! };
  return prepFinished(room, now)
    ? { phase: 'satisfied' }
    : { phase: 'prepping' };
}

/** Whether this actor may strike now: a seated, eligible human on the turn's side. */
export const mayStrike = (
  room: RoomAssemblyState,
  actorId: string,
  phase: PreRoundPhase,
) =>
  phase.phase === 'striking' &&
  !phase.turn.automatic &&
  room.participants.some(
    (p) =>
      p.actorId === actorId &&
      p.role === phase.turn.side &&
      p.kind === 'human' &&
      p.eligible,
  );

/** Facts the adapter loads for a new draw; the engine decides with them. */
export type DrawStartFacts = {
  readonly drawId: string;
  readonly seed: string;
  readonly salt: string;
  /** The bank snapshot at its current revision; null for a host list. */
  readonly bank: DrawBankSnapshot | null;
  /** Bank entries chosen in the seated humans' recent Rounds. */
  readonly exclusions: readonly string[];
};
