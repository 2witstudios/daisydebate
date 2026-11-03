import type { BracketData } from './bracket';
import type { TournamentSource } from './source';
import type { Tournament } from './tournament';

export type BracketRead =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-posted'; readonly tournament: Tournament }
  | {
      readonly kind: 'bracket';
      readonly data: BracketData;
      /** The signed-in viewer's handle, to mark their path. */
      readonly viewerHandle: string | null;
    };

/**
 * The bracket read's one seam. A tournament that has not started has no
 * bracket yet; an unknown id is not found. The backend read replaces this
 * function only.
 */
export function getBracket(
  source: TournamentSource,
  id: string,
  signedIn: boolean,
  now: string,
): BracketRead {
  const tournament = source.tournaments.find((item) => item.id === id);
  if (!tournament) return { kind: 'not-found' };
  const data = source.bracket(id, now);
  return data
    ? {
        kind: 'bracket',
        data,
        viewerHandle: signedIn ? source.viewer.handle : null,
      }
    : { kind: 'not-posted', tournament };
}
