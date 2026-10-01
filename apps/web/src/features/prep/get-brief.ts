import {
  emptyBrief,
  sampleBriefs,
  sampleSpeechLimitSeconds,
} from '../../ui/mock/prep-briefs';
import type { Brief } from './brief';

/** The id a brand-new, unwritten brief answers to. */
export const NEW_BRIEF_ID = 'new';

/**
 * The brief seam: one brief by id (or a blank one for "new"), undefined for
 * an unknown id. The backend read replaces this function and nothing else.
 */
export const getBrief = (id: string): Brief | undefined =>
  id === NEW_BRIEF_ID
    ? emptyBrief
    : sampleBriefs.find((brief) => brief.id === id);

/**
 * The speech limit the debate rules supply, in seconds. Daisy has no speech
 * times yet, so this is a sample; the rules service replaces it here.
 */
export const speechLimitSeconds = (): number => sampleSpeechLimitSeconds;
