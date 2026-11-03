import type { ResultsData } from './results';
import type { TournamentSource } from './source';
import type { Tournament } from './tournament';

export type ResultsRead =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unpublished'; readonly tournament: Tournament }
  | { readonly kind: 'results'; readonly data: ResultsData };

/**
 * The results read's one seam. Only a published tournament has results; an
 * unknown id is not found. The backend read replaces this function only.
 */
export function getResults(
  source: TournamentSource,
  id: string,
  signedIn: boolean,
): ResultsRead {
  const tournament = source.tournaments.find((item) => item.id === id);
  if (!tournament) return { kind: 'not-found' };
  const data = source.results(id, signedIn);
  return data ? { kind: 'results', data } : { kind: 'unpublished', tournament };
}
