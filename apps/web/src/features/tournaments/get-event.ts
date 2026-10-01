import { sampleEvent } from '../../ui/mock/tournament-events';
import type { EventData } from './event';

/**
 * The participant event read's one seam: the viewer's event in a tournament
 * at `now`, or null when they are not competing in it. The backend read
 * replaces this function only.
 */
export const getEvent = (id: string, now: string): EventData | null => {
  const data = sampleEvent(now);
  return data?.tournament.id === id ? data : null;
};
