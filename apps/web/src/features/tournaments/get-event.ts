import type { EventData } from './event';
import type { TournamentSource } from './source';

/**
 * The participant event read's one seam: the viewer's event in a tournament
 * at `now`, or null when they are not competing in it. The backend read
 * replaces this function only.
 */
export const getEvent = (
  source: TournamentSource,
  id: string,
  now: string,
): EventData | null => {
  const data = source.event(now);
  return data?.tournament.id === id ? data : null;
};
