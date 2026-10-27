import {
  readMediaBotLeases,
  mediaPublicationParticipants,
} from './media-publication-authority';
import { mediaVendorMutations } from './schema/media-vendor-mutations';
import { createAppError } from '@daisy/errors';
import { and, eq, isNull } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import {
  lockMediaRound,
  mediaId,
  type MediaCaller,
} from './media-session-authority';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { hydrateRoundRows } from './round-hydration';
import { mediaParticipants, mediaSessions } from './schema/media-sessions';
import { mediaBindingFields } from './media-participant-binding';
import { reconcileLive } from './media-reconcile-rules';

export type MediaSessionRead = {
  readonly roundId: string;
  /** A human reader, bound to its participant-access rule (ADR 0075). */
  readonly caller?: MediaCaller;
  readonly buildProjection: LockedRoundTickInput['buildProjection'];
};
/** Private canonical snapshot, never an HTTP payload. All times follow the final session lock. */
export async function lockedMediaSnapshot(
  tx: BoundedTransactionContext,
  input: MediaSessionRead,
) {
  const roundId = mediaId(input.roundId);
  const authority = await lockMediaRound(tx, roundId, input.caller);
  const [session] = await tx
    .select()
    .from(mediaSessions)
    .where(eq(mediaSessions.roundId, roundId))
    .for('update');
  if (!session) return null;
  const botLeases = await readMediaBotLeases(
    tx,
    roundId,
    authority.participants,
  );
  const tick = await executeLockedRoundTick(tx, {
    roundId,
    buildProjection: input.buildProjection,
  });
  const round = await hydrateRoundRows(tx, roundId);
  if (!round) throw createAppError('NOT_FOUND');
  const bindings = await tx
    .select(mediaBindingFields)
    .from(mediaSessions)
    .innerJoin(
      mediaParticipants,
      eq(mediaParticipants.sessionId, mediaSessions.id),
    )
    .where(eq(mediaSessions.id, session.id));
  const pending = await tx
    .select({ id: mediaVendorMutations.id })
    .from(mediaVendorMutations)
    .where(
      and(
        eq(mediaVendorMutations.sessionId, session.id),
        isNull(mediaVendorMutations.settledAt),
      ),
    );
  return {
    session,
    round,
    ...authority,
    participants: mediaPublicationParticipants(
      authority.participants,
      botLeases,
      round,
      tick.now,
    ),
    bindings,
    now: tick.now,
    finalSegmentEndedAt: tick.finalSegmentEndedAt,
    unresolved: pending.length > 0,
    reconciling: reconcileLive(session, new Date(tick.now)),
  };
}
export type MediaSessionSnapshot = NonNullable<
  Awaited<ReturnType<typeof lockedMediaSnapshot>>
>;
