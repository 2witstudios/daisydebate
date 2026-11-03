import type { PrepSource } from '../source';
import type { Case } from './case';

/**
 * The case seam: one case by id, or undefined for an unknown id. The backend
 * read replaces this function and nothing else.
 */
export const getCase = (source: PrepSource, id: string): Case | undefined =>
  source.cases.find((c) => c.id === id);

/** Every case the owner has, for choosing one to bring into a debate. */
export const listCases = (source: PrepSource): readonly Case[] => source.cases;
