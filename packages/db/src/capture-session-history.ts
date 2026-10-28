import { and, eq, inArray } from 'drizzle-orm';
import type { CaptureTx } from './media-capture-context';
import { mediaVendorMutations } from './schema/media-vendor-mutations';

/** Vendor lifecycle evidence survives rotation, even when no PCM or text was persisted. */
export async function captureSessionInterrupted(
  tx: CaptureTx,
  sessionId: string,
  segment: {
    readonly startedAt: Date;
    readonly endedAt: Date | null;
    readonly durationMs: number;
  },
) {
  const history = await tx
    .select({
      kind: mediaVendorMutations.kind,
      dispatchedAt: mediaVendorMutations.dispatchedAt,
      settledAt: mediaVendorMutations.settledAt,
      outcome: mediaVendorMutations.outcome,
    })
    .from(mediaVendorMutations)
    .where(
      and(
        eq(mediaVendorMutations.sessionId, sessionId),
        inArray(mediaVendorMutations.kind, ['create', 'delete']),
      ),
    );
  const start = segment.startedAt.getTime();
  const end = Math.min(
    segment.endedAt?.getTime() ?? Infinity,
    start + segment.durationMs,
  );
  const creations = history.filter(
    (row) => row.kind === 'create' && row.outcome === 'succeeded',
  );
  return (
    history.some(
      (row) =>
        row.kind === 'delete' &&
        row.outcome !== 'failed' &&
        row.dispatchedAt.getTime() < end &&
        !creations.some(
          (creation) =>
            row.settledAt !== null &&
            creation.dispatchedAt >= row.settledAt &&
            creation.settledAt !== null &&
            creation.settledAt.getTime() <= start,
        ),
    ) ||
    creations.some(
      (row) =>
        row.dispatchedAt.getTime() >= start &&
        row.dispatchedAt.getTime() < end &&
        creations.some((previous) => previous.dispatchedAt < row.dispatchedAt),
    )
  );
}
