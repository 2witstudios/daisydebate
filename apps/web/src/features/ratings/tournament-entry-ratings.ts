import type { TournamentRatingSnapshot } from '@daisy/protocol/lobby/rating-snapshot';
import { entryRating, type RatingSnapshot } from '@daisy/tab-engine';

/** Draw and standings consume the same retained start input; late entries remain unrated. */
export function tournamentEntryRatings(
  snapshot: TournamentRatingSnapshot | null,
  eventId: string,
  entries: readonly { readonly id: string }[],
  members: readonly { readonly entryId: string; readonly actorId: string }[],
): RatingSnapshot | null {
  const event = snapshot?.events.find((row) => row.eventId === eventId);
  if (!snapshot || !event?.ladderId) return null;
  const ladder = snapshot.ladders.find(
    (row) => row.ladderId === event.ladderId,
  );
  if (!ladder) return null;
  return {
    ladder: ladder.ladderId,
    takenAt: snapshot.takenAt,
    calculation: snapshot.calculation,
    entries: entries.map((entry) => ({
      entry: entry.id,
      ...entryRating(
        members
          .filter((row) => row.entryId === entry.id)
          .map((member) => {
            const state = ladder.actors.find(
              (row) => row.actorId === member.actorId,
            );
            return state
              ? {
                  status: 'rated',
                  rating: Math.round(state.rating),
                  deviation: Math.round(state.deviation),
                }
              : { status: 'unrated' };
          }),
      ),
    })),
  };
}
