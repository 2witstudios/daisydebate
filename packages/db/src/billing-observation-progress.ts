import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceCleanup,
  type CleanupEvent,
  type CleanupState,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { cleanupFacts, cleanupContext } from './billing-cleanup-authority';
import { privacyJobs } from './schema/privacy-jobs';

/** Observation writes and their exact consumed remainder commit or roll back together. */
export async function commitObservationProgress(
  tx: BoundedTransactionContext,
  input: {
    readonly jobId: string;
    readonly userId: string;
    readonly closedAt: string;
    readonly state: CleanupState;
    readonly event: Extract<CleanupEvent, { kind: 'retained' | 'payments' }>;
  },
) {
  const facts = await cleanupFacts(tx, input.userId);
  const context = await cleanupContext(tx, input.jobId, facts.effects);
  const transition = advanceCleanup(input.state, input.event, {
    ...context,
    observationOwner: { userId: input.userId, closedAt: input.closedAt },
  });
  if (
    transition.kind !== 'progress' ||
    transition.state.kind === 'acknowledged'
  )
    throw createAppError('CONFLICT');
  await tx
    .update(privacyJobs)
    .set({
      billingCleanup: transition.state,
      retryAt: new Date(transition.state.retryAt),
    })
    .where(eq(privacyJobs.id, input.jobId));
  return 'progress' as const;
}
