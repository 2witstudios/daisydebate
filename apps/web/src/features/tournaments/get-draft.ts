import type { Draft } from './create-wizard';
import type { TournamentSource } from './source';

/**
 * The create wizard's one seam: the organizer's draft. Read-only; the drafts
 * service replaces this function only.
 */
export const getDraft = (source: TournamentSource): Draft => source.draft;
