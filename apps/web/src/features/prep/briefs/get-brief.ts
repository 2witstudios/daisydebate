import type { PrepSource } from '../source';
import type { Brief } from './brief';

/** The id a brand-new, unwritten brief answers to. */
export const NEW_BRIEF_ID = 'new';

/**
 * The brief seam: one brief by id (or a blank one for "new"), undefined for
 * an unknown id. The backend read replaces this function and nothing else.
 */
export const getBrief = (source: PrepSource, id: string): Brief | undefined =>
  id === NEW_BRIEF_ID
    ? source.emptyBrief
    : source.briefs.find((brief) => brief.id === id);
