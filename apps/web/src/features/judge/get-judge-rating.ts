import { sampleJudgeRating } from '../../ui/mock/judge';
import type { JudgeRating } from './rating';

/**
 * The judge rating's one data seam: the signed-in judge's private rating
 * and recent ballots. Today it returns the sample; the backend read
 * replaces this function and nothing else.
 */
export function getJudgeRating(): JudgeRating {
  return sampleJudgeRating;
}
