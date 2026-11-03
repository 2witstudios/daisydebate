import {
  SPECTATOR_MARGIN_MS,
  type BroadcastReleasePolicy,
} from '@daisy/protocol';
import { RANKED_DELAY_SECONDS } from './broadcast-release';

export type SpectatorHorizonFacts = {
  readonly nowMs: number;
  readonly competitionType: 'ranked' | 'casual';
  /** The Round completed or was abandoned. */
  readonly roundTerminal: boolean;
  readonly broadcast: null | {
    readonly policy: BroadcastReleasePolicy;
    readonly releasedThroughMs: number | null;
    readonly completedAtMs: number | null;
    readonly stoppedAtMs: number | null;
  };
};

/** A fact as old as `delayMs` passes `factReleased` at this horizon. */
const floorOf = (nowMs: number, delayMs: number) =>
  nowMs - delayMs + SPECTATOR_MARGIN_MS;

const finishedFloor = (
  policy: BroadcastReleasePolicy,
  facts: SpectatorHorizonFacts,
): number => floorOf(facts.nowMs, policy.seconds * 1000);

/**
 * How far the audience's knowledge has reached: `factReleased` compares a fact's
 * capture time with this. An open Broadcast is its durable watermark alone. A
 * finished one will release no more media, so what it held leaves behind its
 * own delay. With no Broadcast live facts stay private; an ended casual Round
 * has nothing holding it, and an ended ranked Round keeps the fixed floor.
 * Packages/db `spectatorHorizonSql` states this rule for list reads.
 */
export const spectatorHorizon = (
  facts: SpectatorHorizonFacts,
): number | null => {
  const { broadcast } = facts;
  if (broadcast === null) {
    if (!facts.roundTerminal) return null;
    return facts.competitionType === 'ranked'
      ? floorOf(facts.nowMs, RANKED_DELAY_SECONDS * 1000)
      : floorOf(facts.nowMs, 0);
  }
  if (broadcast.completedAtMs === null && broadcast.stoppedAtMs === null)
    return broadcast.releasedThroughMs;
  const floor = finishedFloor(broadcast.policy, facts);
  if (floor === null) return broadcast.releasedThroughMs;
  return Math.max(broadcast.releasedThroughMs ?? floor, floor);
};

/**
 * How far the spectator timeline itself may go. A stop ends it: the watermark
 * stands where the stop left it, so no fact appears afterwards. The competitive
 * record does not end with the video, so list reads keep `spectatorHorizon`.
 */
export const spectatorTimelineHorizon = (
  facts: SpectatorHorizonFacts,
): number | null =>
  facts.broadcast?.stoppedAtMs != null
    ? facts.broadcast.releasedThroughMs
    : spectatorHorizon(facts);
