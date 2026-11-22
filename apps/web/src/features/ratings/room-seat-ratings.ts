import type { RatingState } from '@daisy/protocol/ratings';
import type { RoomView } from '@daisy/protocol/room-contract';
import { isTemporaryRefusal } from '@daisy/db/capacity';
import { ratingStanding } from './standing';

/** A seat's rating as the card read has it: released, active season. */
export type SeatRatingState = RatingState & {
  readonly actorId: string;
  readonly lobbyId: string;
  readonly ladderId: string;
  readonly lastRatedAt: string | null;
};

export type SeatRatingReads = {
  /** One batched card read of the given actors' ratings. */
  readonly ratings: (
    actorIds: readonly string[],
  ) => Promise<readonly SeatRatingState[]>;
  /** Actors whose ratings this viewer may not see before their ballot. */
  readonly blinded: () => Promise<readonly string[]>;
};

/** Any Room view: the overlay reads and rewrites its participants alone. */
type SeatedView = Pick<RoomView, 'participants'>;
type SeatRatingPool = Pick<SeatRatingState, 'lobbyId' | 'ladderId'>;

/** The seated humans whose ratings a view may carry: never a bot or an anonymous judge. */
export const ratedSeatActorIds = (view: SeatedView): readonly string[] => [
  ...new Set(
    view.participants.flatMap((p) =>
      'anonymous' in p || p.kind !== 'human' ? [] : [p.actorId],
    ),
  ),
];

/**
 * Each seated human's rating as this viewer may see it (SEAT-7), the people
 * list's rule: a blinded actor shows none, and a shown rating is the card's
 * released state widened and classified at `now`, as one whole number. A bot
 * and a human with no rating show none; an anonymous judge carries no field.
 */
export const overlaySeatRatings = <View extends SeatedView>(
  view: View,
  input: {
    readonly ratings: readonly SeatRatingState[];
    readonly blinded: readonly string[];
    readonly now: string;
    readonly pool: SeatRatingPool;
  },
): View => {
  const hidden = new Set(input.blinded);
  return {
    ...view,
    participants: view.participants.map((p) => {
      if ('anonymous' in p) return p;
      if (p.kind !== 'human' || hidden.has(p.actorId))
        return { ...p, rating: null };
      const state = input.ratings.find(
        (r) =>
          r.actorId === p.actorId &&
          r.lobbyId === input.pool.lobbyId &&
          r.ladderId === input.pool.ladderId,
      );
      if (!state) return { ...p, rating: null };
      const standing = ratingStanding(state, state.lastRatedAt, input.now);
      return {
        ...p,
        rating: { value: standing.rating, provisional: standing.provisional },
      };
    }),
  };
};

/**
 * One ratings read and one blinding read per view, whatever the seat count.
 * A rating only decorates a seat, and the card read takes the social lane: a
 * social burst the lane refuses for now (ADR 0088) shows every seat without
 * one, so the Room read never fails on it. A refusal that cannot clear, and
 * any other failure, still fails the read.
 */
export async function withSeatRatings<View extends SeatedView>(
  view: View,
  reads: SeatRatingReads,
  now: string,
  pool: SeatRatingPool | null,
): Promise<View> {
  if (!pool) return view;
  const actorIds = ratedSeatActorIds(view);
  if (actorIds.length === 0) return view;
  try {
    const [ratings, blinded] = await Promise.all([
      reads.ratings(actorIds),
      reads.blinded(),
    ]);
    return overlaySeatRatings(view, { ratings, blinded, now, pool });
  } catch (error) {
    if (!isTemporaryRefusal(error)) throw error;
    // Neither read is trusted alone: a blinding unread hides every rating.
    return overlaySeatRatings(view, { ratings: [], blinded: [], now, pool });
  }
}
