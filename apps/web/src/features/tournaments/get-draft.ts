import { sampleDraft } from '../../ui/mock/tournament-organizer';
import type { Draft } from './create-wizard';

/**
 * The create wizard's one seam: the organizer's draft. Today it is a sample
 * and read-only; the drafts service replaces this function only.
 */
export const getDraft = (): Draft => sampleDraft;
