import type { CleanupWork } from '@daisy/protocol/billing';

/** One claimed cleanup step; the store revalidates it after all waits. */
export type CleanupDeliveryRequest = {
  readonly jobId: string;
  readonly claimId: string;
  readonly work: CleanupWork;
  readonly retryAt: string;
};
