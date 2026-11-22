/**
 * Who watches a Round's live room without a seat (`round.observe.undelayed`,
 * ADR 0099 and ADR 0155): its seatless host on any Round, and on a Youth Round
 * each youth debater's linked adults, the same people who may see its
 * Recording minutes later (ADR 0150). They see the clock, the speech order,
 * the transcript and the floor chat, undelayed; never media, and they post
 * nothing. A seat always comes first: anyone seated keeps their own seat's view.
 */

import { isRoundRunning, roundStatusSchema } from '@daisy/protocol/round';
import { type LiveStanding } from '@daisy/protocol/youth-round';
import { type YouthLiveFact } from '@daisy/protocol/youth-live';

export type { YouthLiveFact };

/**
 * The Round as this rule reads it. `youth` is present exactly when its Room
 * is in the Youth lobby (ADR 0162), and null on every other Round.
 */
export type LiveAudienceRound = {
  readonly createdByActorId: string | null;
  /** Kept a loose string: authorization facts carry the stored status as read. */
  readonly status: string;
  readonly participants: readonly { readonly actorId: string }[];
  readonly youth: YouthLiveFact | null;
};

export type LiveAudienceViewer =
  | { readonly kind: 'visitor' }
  | { readonly kind: 'account'; readonly actorId: string };

export type LiveAudience =
  | {
      readonly kind: 'undelayed_no_media';
      readonly as: 'host' | 'linked_adult';
    }
  | {
      readonly kind: 'denied';
      readonly reason: 'signed_out' | 'seated' | 'not_live' | 'not_in_audience';
    };

/** The stored status as read, judged by protocol's one running predicate. */
const running = (status: string): boolean => {
  const parsed = roundStatusSchema.safeParse(status);
  return parsed.success && isRoundRunning(parsed.data);
};

/** Where the viewer stands towards the Round, in the lobby's terms (`LiveStanding`). */
const standingOf = (
  round: LiveAudienceRound,
  actorId: string,
): LiveStanding => {
  if (round.participants.some((seat) => seat.actorId === actorId))
    return 'seat';
  if (round.createdByActorId === actorId) return 'seatless-host';
  return round.youth?.linkedAdultActorIds.includes(actorId) === true
    ? 'linked-adult'
    : 'none';
};

const watches = (as: 'host' | 'linked_adult') =>
  ({ kind: 'undelayed_no_media', as }) as const;
const denied = (
  reason: 'signed_out' | 'seated' | 'not_live' | 'not_in_audience',
) => ({ kind: 'denied', reason }) as const;

export const liveAudience = (
  round: LiveAudienceRound,
  viewer: LiveAudienceViewer,
): LiveAudience => {
  if (viewer.kind !== 'account') return denied('signed_out');
  const standing = standingOf(round, viewer.actorId);
  switch (standing) {
    case 'seat':
      return denied('seated');
    case 'seatless-host':
      return watches('host');
    case 'none':
      return denied('not_in_audience');
    case 'linked-adult':
      // They see through the Room's visibility (ADR 0161), only while it
      // runs; then they see it through its Recording.
      return running(round.status)
        ? watches('linked_adult')
        : denied('not_live');
  }
};
