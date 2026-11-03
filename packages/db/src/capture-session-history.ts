import { speakingEndMs } from '@daisy/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { mediaSessions } from './schema/media-sessions';
import { roundIncidents } from './schema/round-incidents';
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
    readonly returnedMs: number;
  },
) {
  const incidents = await tx
    .select({
      from: sql<Date>`coalesce(${roundIncidents.resumePoint}, ${roundIncidents.detectedAt})`.mapWith(
        roundIncidents.detectedAt,
      ),
      resumedAt: roundIncidents.resumedAt,
      endedAt: roundIncidents.endedAt,
    })
    .from(roundIncidents)
    .innerJoin(mediaSessions, eq(mediaSessions.roundId, roundIncidents.roundId))
    .where(eq(mediaSessions.id, sessionId));
  /** A vendor change inside an incident's span is the incident, stated elsewhere. */
  const excused = (at: Date) =>
    incidents.some(
      ({ from, resumedAt, endedAt }) =>
        at.getTime() >= from.getTime() &&
        at.getTime() <= (resumedAt ?? endedAt ?? new Date(8.64e15)).getTime(),
    );
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
  const end = speakingEndMs({
    startedAtMs: start,
    endedAtMs: segment.endedAt?.getTime() ?? null,
    durationMs: segment.durationMs,
    returnedMs: segment.returnedMs,
  });
  const creations = history.filter(
    (row) => row.kind === 'create' && row.outcome === 'succeeded',
  );
  return (
    history.some(
      (row) =>
        row.kind === 'delete' &&
        row.outcome !== 'failed' &&
        !excused(row.dispatchedAt) &&
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
        !excused(row.dispatchedAt) &&
        row.dispatchedAt.getTime() >= start &&
        row.dispatchedAt.getTime() < end &&
        creations.some((previous) => previous.dispatchedAt < row.dispatchedAt),
    )
  );
}
