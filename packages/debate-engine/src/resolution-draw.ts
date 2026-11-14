import { createAppError } from '@daisy/errors';
import {
  dueAfterStops,
  type ClockStop,
  type DebateSide,
  type RoomAssemblyState,
} from '@daisy/protocol';
import { canonicalOrder } from '@daisy/seeded-random';
import { automaticChoice, shuffle } from './draw-random';
import type {
  ResolutionCategory,
  ResolutionDrawItem,
  ResolutionDrawState,
  ResolutionStrike,
  SideControllers,
} from '@daisy/protocol/resolution-draw';
import { AUTOMATIC_STRIKE_DELAY_MS } from '@daisy/protocol/resolution-draw';

type Candidate = {
  readonly id: string;
  readonly text: string;
  readonly category: ResolutionCategory | null;
};

/**
 * The pure draw (`daisy-draw-v1`): drop exclusions, relax them when too few
 * candidates remain, refuse when even the full source is too small, then
 * shuffle the canonical order with the seed and keep the first `size`.
 */
export function drawResolutions(input: {
  readonly candidates: readonly Candidate[];
  readonly exclusions: readonly string[];
  readonly size: number;
  readonly seed: Uint8Array;
}):
  | {
      readonly ok: true;
      readonly items: readonly ResolutionDrawItem[];
      readonly candidateIds: readonly string[];
      readonly exclusions: readonly string[];
      readonly exclusionsRelaxed: boolean;
    }
  | { readonly ok: false } {
  const all = canonicalOrder(input.candidates);
  if (
    new Set(all.map((c) => c.id)).size !== all.length ||
    all.length < input.size
  )
    return { ok: false };
  const excluded = new Set(input.exclusions);
  const kept = all.filter((c) => !excluded.has(c.id));
  const exclusionsRelaxed = kept.length < input.size;
  const pool = exclusionsRelaxed ? all : kept;
  const drawn = shuffle(pool, input.seed).slice(0, input.size);
  return {
    ok: true,
    items: drawn.map((c, position) => ({
      position,
      candidateId: c.id,
      text: c.text,
      category: c.category,
    })),
    candidateIds: pool.map((c) => c.id),
    exclusions: canonicalOrder(input.exclusions.map((id) => ({ id }))).map(
      (e) => e.id,
    ),
    exclusionsRelaxed,
  };
}

const otherSide = (side: DebateSide): DebateSide =>
  side === 'affirmative' ? 'negative' : 'affirmative';

/** One controller per side: automatic only when every debater seat is a bot. */
export const sideControllers = (
  participants: RoomAssemblyState['participants'],
): SideControllers => {
  const controller = (side: DebateSide) =>
    participants.some((p) => p.role === side && p.kind === 'human')
      ? ('human' as const)
      : ('automatic' as const);
  return {
    affirmative: controller('affirmative'),
    negative: controller('negative'),
  };
};

export const revealed = (draw: ResolutionDrawState) =>
  draw.strikes.length >= draw.manifest.drawSize - 1;

export const standingPositions = (draw: ResolutionDrawState) => {
  const struck = new Set(draw.strikes.map((s) => s.position));
  return draw.items.map((i) => i.position).filter((p) => !struck.has(p));
};

/** The open turn, or null once the draw is revealed. */
export const turnOf = (
  draw: ResolutionDrawState,
  stops: readonly ClockStop[],
  nowMs: number,
) => {
  if (revealed(draw)) return null;
  const ordinal = draw.strikes.length;
  const side =
    ordinal % 2 === 0
      ? draw.manifest.firstStriker
      : otherSide(draw.manifest.firstStriker);
  const opensAt = Date.parse(
    ordinal === 0 ? draw.startedAt : draw.strikes[ordinal - 1]!.at,
  );
  const automatic = draw.manifest.controllers[side] === 'automatic';
  return {
    ordinal,
    side,
    automatic,
    dueAt: new Date(
      dueAfterStops(
        opensAt,
        automatic ? AUTOMATIC_STRIKE_DELAY_MS : draw.manifest.strikeWindowMs,
        stops,
        nowMs,
      ),
    ).toISOString(),
  };
};

/** The survivor and the reveal instant, once revealed. */
export const survivorOf = (draw: ResolutionDrawState) => {
  if (!revealed(draw)) return null;
  const position = standingPositions(draw)[0]!;
  return {
    item: draw.items.find((i) => i.position === position)!,
    at: draw.strikes.at(-1)!.at,
  };
};

/**
 * Every strike due at or before `now`, each stamped with its own due
 * instant, so settling by command, read or sweep agrees. A human side's
 * time-out strikes the lowest standing position; an automatic side's
 * choice comes from the seed.
 */
export function settleDraw(
  draw: ResolutionDrawState,
  seed: Uint8Array | null,
  now: string,
  stops: readonly ClockStop[],
): ResolutionDrawState {
  let next = draw;
  for (;;) {
    const turn = turnOf(next, stops, Date.parse(now));
    if (!turn || Date.parse(now) < Date.parse(turn.dueAt)) return next;
    const standing = standingPositions(next);
    if (turn.automatic && !seed)
      throw createAppError(
        'INVARIANT',
        'An automatic strike needs the draw seed',
      );
    const strike: ResolutionStrike = {
      ordinal: turn.ordinal,
      position: turn.automatic
        ? automaticChoice(seed!, turn.ordinal, standing)
        : standing[0]!,
      side: turn.side,
      kind: turn.automatic ? 'automatic' : 'timeout',
      actorId: null,
      commandId: null,
      at: turn.dueAt,
    };
    next = { ...next, strikes: [...next.strikes, strike] };
  }
}

/**
 * The stored topic invariant: a fixed-topic Room has text; a draw Room has
 * none, because its resolution belongs to the Round.
 */
export function topicInvariantHolds(room: RoomAssemblyState): boolean {
  return room.executionPlan.resolutionDraw.enabled
    ? room.topic === null
    : room.topic !== null && room.topic.trim() !== '';
}
