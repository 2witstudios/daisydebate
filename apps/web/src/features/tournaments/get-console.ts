import type { ConsoleData } from './console';
import type { TournamentSource } from './source';

/**
 * The console read's one seam: the tournament as its organizer manages it,
 * or null when it is unknown or not theirs. The backend read replaces this
 * function only.
 */
export const getConsole = (
  source: TournamentSource,
  id: string,
): ConsoleData | null => source.console(id);
