import {
  debateSides,
  type BroadcastStanding,
  type DebateSide,
  type SpectatorTimeline,
} from '@daisy/protocol';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import type { SpectatorTimelineRead } from '@daisy/db';

const sideOf = (role: string): readonly DebateSide[] =>
  debateSides.filter((side) => side === role);

/**
 * How long past its delay released media may be missing before the audience is
 * told. With the 60 second ranked delay this is DEC-303's 90 second alert.
 */
export const BROADCAST_INTERRUPTED_AFTER_MS = 30_000;

/** What the projection needs from outside the read: the instant, and where a Broadcast is read. */
export type SpectatorTimelineContext = {
  readonly nowMs: number;
  /** The public feed under a Broadcast's key; null when this deployment has none. */
  readonly feedUrlOf: (feedKey: string) => string | null;
};

type StageFacts = Pick<
  SpectatorTimelineRead,
  'outcomeReleased' | 'segments' | 'horizonMs'
> & {
  readonly round: Pick<SpectatorTimelineRead['round'], 'status' | 'rules'>;
  readonly stopped: boolean;
};

/** The stage as the released video shows it: one rule for the player and the Live listing. */
export const releasedStage = (read: StageFacts): SpectatorTimeline['stage'] => {
  if (read.round.status === 'opening') return { kind: 'upcoming' };
  if (read.outcomeReleased || read.stopped) return { kind: 'ended' };
  const segment = read.segments[0];
  if (!segment || read.horizonMs === null)
    return { kind: 'slate', moment: 'before_first_speech' };
  const shownAt = read.horizonMs - SPECTATOR_MARGIN_MS;
  const rule = read.round.rules.segments.find((s) => s.key === segment.key);
  if (!rule || (segment.endedAt && segment.endedAt.getTime() <= shownAt))
    return {
      kind: 'slate',
      moment:
        read.round.rules.segments.at(-1)?.key === segment.key
          ? 'speeches_over'
          : 'between_speeches',
    };
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

const ms = (value: Date | null) => value?.getTime() ?? null;

const isTerminal = (status: string) =>
  status === 'completed' || status === 'abandoned';

type Policy = NonNullable<SpectatorTimelineRead['broadcast']>['policy'];

/** The instant a policy still holds the Broadcast until, or null when it no longer holds it. */
const holdOf = (
  policy: Policy,
  terminal: boolean,
  nowMs: number,
): { readonly releasesAt: string | null } | null => {
  if (policy.kind === 'round_end')
    return terminal ? null : { releasesAt: null };
  if (policy.kind === 'at' && nowMs < policy.atMs)
    return { releasesAt: new Date(policy.atMs).toISOString() };
  return null;
};

const delayOwedMs = (policy: Policy) =>
  policy.kind === 'delay' ? policy.seconds * 1000 : 0;

/** When a hold let go, so its first release is not measured from the Round's start. */
const releaseBegan = (policy: Policy, roundEnded: Date | null): number => {
  if (policy.kind === 'round_end') return ms(roundEnded) ?? 0;
  return policy.kind === 'at' ? policy.atMs : 0;
};

/**
 * The audience's stream, from durable facts alone. Who may read this at all is
 * decided before it leaves (`admitAudience`): it names the feed's random key,
 * which is what keeps an unlisted Round's media from being found.
 */
const standingOf = (
  read: SpectatorTimelineRead,
  context: SpectatorTimelineContext,
): BroadcastStanding => {
  const { broadcast, round } = read;
  const manifestUrl = broadcast ? context.feedUrlOf(broadcast.feedKey) : null;
  if (!broadcast || manifestUrl === null) return { state: 'none' };
  if (broadcast.stoppedAt) return { state: 'stopped' };
  const watermark = ms(broadcast.releasedThroughAt);
  if (broadcast.completedAt)
    return { state: watermark === null ? 'failed' : 'ended' };
  const terminal = isTerminal(round.status);
  const hold = holdOf(broadcast.policy, terminal, context.nowMs);
  if (hold) return { state: 'held', ...hold };
  const since = Math.max(
    watermark ?? ms(round.startedAt) ?? context.nowMs,
    releaseBegan(broadcast.policy, round.completedAt),
  );
  const late =
    context.nowMs - delayOwedMs(broadcast.policy) - since >
    BROADCAST_INTERRUPTED_AFTER_MS;
  const stream = { path: 'owned_hls', manifestUrl } as const;
  if (watermark === null) {
    if (!late) return { state: 'starting' };
    return terminal
      ? { state: 'failed' }
      : { state: 'interrupted', stream: null };
  }
  if (!late) return { state: 'on_air', stream };
  // A finished Round sends no more media, so a silent feed has simply ended.
  return terminal ? { state: 'ended' } : { state: 'interrupted', stream };
};

/**
 * A Recording is news only once the Round's end is released, and a stop
 * withholds it from the audience (ADR 0105's one release rule).
 */
const recordingOf = (
  read: SpectatorTimelineRead,
): SpectatorTimeline['recording'] => {
  if (!read.outcomeReleased || read.broadcast?.stoppedAt) return 'none';
  switch (read.recordingStatus) {
    case 'ready':
      return 'ready';
    case 'requested':
    case 'capturing':
    case 'processing':
      return 'processing';
    default:
      return 'none';
  }
};

/** The resolution enters the timeline with the Round's start, never before. */
const resolutionOf = (read: SpectatorTimelineRead) =>
  read.horizonMs !== null &&
  read.round.startedAt !== null &&
  read.round.startedAt.getTime() + SPECTATOR_MARGIN_MS <= read.horizonMs
    ? read.round.resolution
    : null;

/**
 * Winner, scores and reason are public on ranked Rounds; a casual Round releases
 * its winner alone (plan section 5). A tie stays null, and a completed Round
 * alone has a result.
 */
const resultOf = (read: SpectatorTimelineRead): SpectatorTimeline['result'] => {
  if (!read.outcomeReleased || read.round.status !== 'completed') return null;
  const { outcome } = read.round;
  const winner =
    outcome === 'affirmative' || outcome === 'negative' ? outcome : null;
  if (read.round.competitionType !== 'ranked')
    return { winner, ballots: [], ratings: [] };
  return {
    winner,
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
  context: SpectatorTimelineContext,
): SpectatorTimeline => ({
  version: 1,
  roundId: read.round.id,
  mode: read.round.competitionType,
  broadcast: standingOf(read, context),
  recording: recordingOf(read),
  resolution: resolutionOf(read),
  seats: read.seats.flatMap((seat) =>
    sideOf(seat.side).map((side) => ({
      side,
      kind: seat.kind === 'bot' ? ('bot' as const) : ('human' as const),
      label: seat.username ?? seat.botName ?? null,
    })),
  ),
  stage: releasedStage({
    ...read,
    stopped: Boolean(read.broadcast?.stoppedAt),
  }),
  result: resultOf(read),
  captions: read.captions.flatMap((caption) =>
    sideOf(caption.side).map((side) => ({
      id: caption.id,
      side,
      text: caption.text,
    })),
  ),
  releasedThrough: read.broadcast?.releasedThroughAt?.toISOString() ?? null,
});
