import { sampleSummary } from '../../ui/mock/train';
import type { TrainingSummary } from './summary';

/**
 * The Train hub's one data seam: the signed-in account's training summary.
 * Today it returns the sample account; the backend read replaces this
 * function and nothing else imports the mock.
 */
export const getTrainingSummary = (): TrainingSummary => sampleSummary;
