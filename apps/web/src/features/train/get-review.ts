import { sampleReviewCards } from '../../ui/mock/train-review';
import type { ReviewCard } from './review';
import type { TrainingSummary } from './summary';

/**
 * The review's one data seam: the saved arguments due today, in the order to
 * review them. Today it returns sample cards, as many as the summary says are
 * due; the backend read of due cards replaces this function.
 */
export const getReviewQueue = (
  summary: TrainingSummary,
): readonly ReviewCard[] => sampleReviewCards.slice(0, summary.saved.due);
