import { captureRule } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import type { withBoundedRound } from './bounded-transaction.test-support';
import { historicalCapture } from './media-capture.test-support';
import { mediaCaptureOperations } from '../src/media-capture';
type TestContext = Parameters<Parameters<typeof withBoundedRound>[0]>;
export async function configuredCapture(
  f: TestContext[0],
  transaction: TestContext[1],
  roundId: string,
  maxGlobalBytes = 2048,
  maxOutstandingIntents = 65536,
  endedAgoMs = 1000,
  maxRoundBytes = 1024,
) {
  const original = await historicalCapture(f, transaction, roundId, endedAgoMs);
  await original.store.claimMediaWorkerLease({
    ...original.lease,
    leaseMs: 15000,
  });
  const store = mediaCaptureOperations({
    transaction,
    captureRule,
    sttLagMs: 60000,
    nextId: createId,
    buildProjection: () => {
      throw new Error('Historical fixture cannot invent play');
    },
    evidence: {
      leaseMs: 1000,
      nextToken: () => randomBytes(32).toString('base64url'),
      maxRoundBytes,
      maxGlobalBytes,
      maxOutstandingIntents,
    },
  });
  const { trackId, startOffsetMs, durationMs, before, after } = original.clip;
  const window = {
    authorityId: createId(),
    ...original.stream,
    trackId,
    startOffsetMs,
    durationMs,
    before,
    after,
  };
  return { store, window, original };
}
