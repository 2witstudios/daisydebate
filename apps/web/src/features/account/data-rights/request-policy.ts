import type { RateRule } from '../../../server/rate-limit';

/**
 * The data-rights budgets every deployed app runs (ISSUE-833): how often one
 * member may ask for their export or their erasure. Erasure is destructive
 * and vendor-deletion work follows it, so it is the tighter of the two.
 */
export const dataRightsPolicy: {
  readonly exportData: readonly RateRule[];
  readonly erase: readonly RateRule[];
} = Object.freeze({
  exportData: Object.freeze([
    { max: 2, windowSeconds: 3_600 },
    { max: 5, windowSeconds: 86_400 },
  ]),
  erase: Object.freeze([{ max: 3, windowSeconds: 86_400 }]),
});
