import {
  cleanupWork,
  startCleanup,
  type CleanupState,
  type CleanupEvent,
  type CleanupContext,
} from './billing-cleanup';
import { advanceCleanup } from './billing-cleanup-lifecycle';
export const job = 'j'.repeat(24),
  otherJob = 'k'.repeat(24),
  first = 'a'.repeat(24),
  second = 'b'.repeat(24);
export const at = (seconds: number) =>
  new Date(Date.UTC(2026, 10, 5) + seconds * 1000).toISOString();
export const context = (seconds: number): CleanupContext => ({
  jobId: job,
  now: at(seconds),
  closed: true,
});
export function initial() {
  const state = startCleanup(job, at(0));
  if (state === null) throw new Error('Cleanup fixture refused to start');
  return state;
}
export function changed(
  value: CleanupState,
  event: CleanupEvent,
  seconds: number,
  overrides: Partial<CleanupContext> = {},
) {
  const next = advanceCleanup(value, event, {
    ...context(seconds),
    ...overrides,
  });
  if (next.kind === 'idle') throw Error('Cleanup fixture refused');
  return next.state;
}
export function claimed(value: CleanupState, seconds: number, claimId = first) {
  return changed(value, { kind: 'claim', claimId }, seconds);
}
export const page = (
  value: CleanupState,
  ids: string[],
  more = false,
  claimId = first,
): Extract<CleanupEvent, { kind: 'page' }> => {
  const work = cleanupWork(value);
  if (work === null) throw new Error('Cleanup fixture has no work to page');
  return { kind: 'page', claimId, work, ids, more };
};
export function empty(value: CleanupState, seconds: number) {
  const c = claimed(value, seconds);
  return changed(c, page(c, []), seconds + 0.1, {
    effects: {
      mappedCustomers: 0,
      possiblePurchases: 0,
      retainedFinancialRoutes: 0,
      owedFinancialEffects: false,
    },
  });
}
