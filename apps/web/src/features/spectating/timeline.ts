import {
  debateSides,
  type DebateSide,
  type SpectatorTimeline,
} from '@daisy/protocol';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import type { SpectatorTimelineRead } from '@daisy/db';

const sideOf = (role: string): readonly DebateSide[] =>
  debateSides.filter((side) => side === role);

const stageOf = (read: SpectatorTimelineRead): SpectatorTimeline['stage'] => {
  if (read.round.status === 'scheduled') return { kind: 'upcoming' };
  if (read.outcomeReleased) return { kind: 'ended' };
  const segment = read.segments[0];
  if (!segment || read.horizonMs === null) return { kind: 'slate' };
  const shownAt = read.horizonMs - SPECTATOR_MARGIN_MS;
  const rule = read.round.rules.segments.find((s) => s.key === segment.key);
  if (!rule || (segment.endedAt && segment.endedAt.getTime() <= shownAt))
    return { kind: 'slate' };
  return {
    kind: 'floor',
    segment: segment.type,
    label: rule.label,
    side: rule.side,
    remainingMs: Math.max(
      0,
      segment.durationMs - (shownAt - segment.startedAt.getTime()),
    ),
  };
};

/** The resolution enters the timeline with the Round's start, never before. */
const resolutionOf = (read: SpectatorTimelineRead) =>
  read.horizonMs !== null &&
  read.round.startedAt !== null &&
  read.round.startedAt.getTime() + SPECTATOR_MARGIN_MS <= read.horizonMs
    ? read.round.resolution
    : null;

/**
 * Winner, scores and reason are public on ranked Rounds only (plan section 5),
 * and a tie stays null. A completed Round alone has a result.
 */
const resultOf = (read: SpectatorTimelineRead): SpectatorTimeline['result'] => {
  if (
    read.round.competitionType !== 'ranked' ||
    !read.outcomeReleased ||
    read.round.status !== 'completed'
  )
    return null;
  const { outcome } = read.round;
  return {
    winner:
      outcome === 'affirmative' || outcome === 'negative' ? outcome : null,
    ballots: read.ballots.flatMap((ballot) =>
      sideOf(ballot.winner).map((winner) => ({
        winner,
        scores: ballot.scores,
        reason: ballot.reason,
      })),
    ),
    ratings: read.ratings.flatMap((rating) =>
      sideOf(rating.side).map((side) => ({
        side,
        before: Math.round(rating.before),
        after: Math.round(rating.after),
      })),
    ),
  };
};

/** One server-owned view of a Round for its audience, built from released rows alone. */
export const projectSpectatorTimeline = (
  read: SpectatorTimelineRead,
): SpectatorTimeline => ({
  version: 1,
  roundId: read.round.id,
  mode: read.round.competitionType,
  hasBroadcast: read.hasBroadcast,
  resolution: resolutionOf(read),
  seats: read.seats.flatMap((seat) =>
    sideOf(seat.side).map((side) => ({
      side,
      kind: seat.kind === 'bot' ? ('bot' as const) : ('human' as const),
      label: seat.username ?? seat.botName ?? null,
    })),
  ),
  stage: stageOf(read),
  result: resultOf(read),
  captions: read.captions.flatMap((caption) =>
    sideOf(caption.side).map((side) => ({
      id: caption.id,
      side,
      text: caption.text,
    })),
  ),
  releasedThrough: read.releasedThroughAt?.toISOString() ?? null,
});
