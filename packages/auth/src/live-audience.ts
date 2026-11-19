/**
 * Who watches a Round's live room without a seat (`round.observe.undelayed`,
 * ADR 0099 and ADR 0155): its seatless host on any Round, and on a Youth Round
 * each youth debater's linked adults, the same people who may see its
 * Recording minutes later (ADR 0150). They see the clock, the speech order,
 * the transcript and the floor chat, undelayed; never media, and they post
 * nothing. A seat always comes first: anyone seated keeps their own seat's view.
 */

import { runningRoundStatuses, type YouthLiveFact } from '@daisy/protocol';

export type { YouthLiveFact };

/** The Round as this rule reads it. `youth` is null on every Round that is not a Youth one. */
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

const running = (status: string): boolean =>
  (runningRoundStatuses as readonly string[]).includes(status);

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
  const { actorId } = viewer;
  if (round.participants.some((seat) => seat.actorId === actorId))
    return denied('seated');
  if (round.createdByActorId === actorId) return watches('host');
  if (round.youth?.linkedAdultActorIds.includes(actorId) !== true)
    return denied('not_in_audience');
  // A linked adult follows the Round only while it runs; once it ends they
  // see it through its Recording, under ADR 0150's own rules.
  return running(round.status) ? watches('linked_adult') : denied('not_live');
};
