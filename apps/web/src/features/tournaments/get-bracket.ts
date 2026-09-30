import { sampleBracket } from '../../ui/mock/tournament-brackets';
import { sampleTournaments } from '../../ui/mock/tournaments';
import type { BracketData } from './bracket';
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
  id: string,
  signedIn: boolean,
  now: string,
): BracketRead {
  const tournament = sampleTournaments.find((item) => item.id === id);
  if (!tournament) return { kind: 'not-found' };
  const data = sampleBracket(id, now);
  return data
    ? { kind: 'bracket', data, viewerHandle: signedIn ? 'debater-a' : null }
    : { kind: 'not-posted', tournament };
}
