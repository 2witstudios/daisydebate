import { defaultPassage, layered } from '../../ui/mock/prep-cards';
import type { Segment } from './card';

/**
 * The card draft seam: the source text being turned into a card, with its
 * layers. There is no draft store yet, so it is a fixed sample; the backend
 * read of the owner's draft replaces this function and nothing else.
 */
export const getDraftSegments = (): readonly Segment[] =>
  layered(defaultPassage);
