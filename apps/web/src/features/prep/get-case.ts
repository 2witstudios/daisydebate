import { sampleCases } from '../../ui/mock/prep-cases';
import type { Case } from './case';

/**
 * The case seam: one case by id, or undefined for an unknown id. The backend
 * read replaces this function and nothing else.
 */
export const getCase = (id: string): Case | undefined =>
  sampleCases.find((c) => c.id === id);
