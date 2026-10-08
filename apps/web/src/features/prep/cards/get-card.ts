import { sampleCards, sampleReadingPace } from '../../../ui/mock/prep-cards';
import type { Card } from './card';

/**
 * The card detail seam: one card by id, or undefined for an unknown id. The
 * backend read replaces this function and nothing else.
 */
export const getCard = (id: string): Card | undefined =>
  sampleCards.find((card) => card.id === id);

/** The owner's reading pace in words a minute (a sample setting today). */
export const readingPace = (): number => sampleReadingPace;
