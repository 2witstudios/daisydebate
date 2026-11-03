import type { PrepSource } from '../source';
import type { Card } from './card';

/**
 * The card detail seam: one card by id, or undefined for an unknown id. The
 * backend read replaces this function and nothing else.
 */
export const getCard = (source: PrepSource, id: string): Card | undefined =>
  source.cards.find((card) => card.id === id);
