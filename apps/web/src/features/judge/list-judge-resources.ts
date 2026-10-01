import { sampleResources } from '../../ui/mock/judge';
import type { JudgeResource } from './resources';

/**
 * The judging resources' one data seam. Today it returns the sample cards;
 * the content source replaces this function and nothing else.
 */
export function listJudgeResources(): readonly JudgeResource[] {
  return sampleResources;
}
