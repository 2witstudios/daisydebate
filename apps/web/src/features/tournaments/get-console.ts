import { sampleConsole } from '../../ui/mock/tournament-console';
import type { ConsoleData } from './console';

/**
 * The console read's one seam: the tournament as its organizer manages it,
 * or null when it is unknown or not theirs. The backend read replaces this
 * function only.
 */
export const getConsole = (id: string): ConsoleData | null => sampleConsole(id);
