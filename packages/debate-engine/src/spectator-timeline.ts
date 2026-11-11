import {
  debateSides,
  recordingPreparationOf,
  type BroadcastStanding,
  type DebateSide,
  type SpectatorTimeline,
} from '@daisy/protocol';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';

type FloorStage = Extract<SpectatorTimeline['stage'], { kind: 'floor' }>;

/**
 * The persisted facts of one Round for its audience, already held to the horizon by
 * the read. The adapter's rows meet this shape; this module imports no adapter.
 */
export type SpectatorTimelineRead = {
  readonly round: {
    readonly id: string;
    readonly visibility: string | null;
    readonly status: string;
    readonly competitionType: 'ranked' | 'casual';
    readonly resolution: string | null;
    readonly rules: {
      readonly segments: readonly {
        readonly key: string;
        readonly label: string;
        readonly side: FloorStage['side'];
      }[];
    };
    readonly outcome: string | null;
    readonly startedAt: Date | null;
    readonly completedAt: Date | null;
    readonly roomId: string | null;
  };
  readonly broadcast: null | {
    readonly id: string;
    readonly feedKey: string;
    readonly deliveryPath: string;
    readonly policy: { readonly seconds: number };
    readonly releasedThroughAt: Date | null;
    readonly completedAt: Date | null;
    readonly stoppedAt: Date | null;
    readonly mediaWithheld: boolean;
  };
  readonly recordingStatus: string | null;
  readonly recordingLifecycle:
    Parameters<typeof recordingPreparationOf>[0] | null;
  readonly recordingJob: Parameters<typeof recordingPreparationOf>[1];
  readonly seats: readonly {
    readonly side: string;
    readonly kind: string;
    readonly username: string | null;
    readonly botName: string | null;
  }[];
  readonly horizonMs: number | null;
  readonly segments: readonly {
    readonly type: FloorStage['segment'];
    readonly key: string;
    readonly startedAt: Date;
    readonly endedAt: Date | null;
    readonly durationMs: number;
  }[];
  readonly ballots: readonly {
    readonly winner: string;
    readonly scores: NonNullable<
      SpectatorTimeline['result']
    >['ballots'][number]['scores'];
    readonly reason: string;
  }[];
  readonly ratings: readonly {
    readonly side: string;
    readonly before: number;
    readonly after: number;
  }[];
  readonly captions: readonly {
    readonly id: string;
    readonly side: string;
    readonly text: string;
  }[];
  readonly outcomeReleased: boolean;
};

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
  readonly round: Pick<
    SpectatorTimelineRead['round'],
    'status' | 'rules' | 'startedAt'
  >;
  readonly stopped: boolean;
};

/** Whether the released stage is past the format's last speech. */
const pastLastSpeech = (read: StageFacts, key: string) =>
  read.round.rules.segments.at(-1)?.key === key;

/** A slate says only what the horizon has passed, so it is never ahead of the feed. */
const slateBefore = (read: StageFacts): SpectatorTimeline['stage'] => ({
  kind: 'slate',
  moment:
    read.horizonMs !== null &&
    read.round.startedAt !== null &&
    read.round.startedAt.getTime() + SPECTATOR_MARGIN_MS <= read.horizonMs
      ? 'before_first_speech'
      : 'unreleased',
});

/** The stage as the released video shows it: one rule for the player and the Live listing. */
export const releasedStage = (read: StageFacts): SpectatorTimeline['stage'] => {
  if (read.round.status === 'opening') return { kind: 'upcoming' };
  if (read.outcomeReleased || read.stopped) return { kind: 'ended' };
  const segment = read.segments[0];
  if (!segment || read.horizonMs === null) return slateBefore(read);
  const shownAt = read.horizonMs - SPECTATOR_MARGIN_MS;
  const rule = read.round.rules.segments.find((s) => s.key === segment.key);
  if (!rule) return slateBefore(read);
  if (segment.endedAt && segment.endedAt.getTime() <= shownAt)
    return {
      kind: 'slate',
      moment: pastLastSpeech(read, segment.key)
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
  const since = watermark ?? ms(round.startedAt) ?? context.nowMs;
  const late =
    context.nowMs - broadcast.policy.seconds * 1000 - since >
    BROADCAST_INTERRUPTED_AFTER_MS;
  const stream = { path: 'owned_hls', manifestUrl } as const;
  // The watermark passes the strike and the opening before any media exists: the
  // feed has nothing to play until a speech has been released.
  if (watermark === null || (read.segments.length === 0 && !late)) {
    if (!late) return { state: 'starting' };
    return read.outcomeReleased
      ? { state: 'failed' }
      : { state: 'interrupted', stream: null };
  }
  if (!late) return { state: 'on_air', stream };
  // A finished Round sends no more media, so a silent feed has simply ended. Over means
  // released: until then this public read may not say the Round has finished.
  return read.outcomeReleased
    ? { state: 'ended' }
    : { state: 'interrupted', stream };
};

/**
 * A Recording is news only once the Round's end is released, and an operator's
 * stop withholds it from the audience (ADR 0105's one release rule).
 */
const recordingOf = (
  read: SpectatorTimelineRead,
): SpectatorTimeline['recording'] => {
  if (!read.outcomeReleased || read.broadcast?.mediaWithheld) return 'none';
  switch (read.recordingStatus) {
    case 'ready':
      return 'ready';
    case 'requested':
    case 'capturing':
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case null:
    default:
      return 'none';
  }
};

/** Only a Recording this audience may know of as `processing` says how far it is. */
const preparationOf = (read: SpectatorTimelineRead, nowMs: number) => {
  const preparation =
    read.recordingLifecycle !== null && recordingOf(read) === 'processing'
      ? recordingPreparationOf(
          read.recordingLifecycle,
          read.recordingJob,
          nowMs,
        )
      : null;
  return preparation ? { recordingPreparation: preparation } : {};
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
  ...preparationOf(read, context.nowMs),
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
