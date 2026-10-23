import { createAppError } from '@daisy/errors';
import {
  botActivityBatchSchema,
  botActivityRelaySchema,
  botHeardRelaySchema,
} from '@daisy/protocol/bot-activity';

type CaptureIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
type CaptureRead = {
  readonly serverNow: string;
  readonly segment: {
    readonly id: string;
    readonly endedAt: string | null;
  } | null;
  readonly participants: readonly {
    readonly roundParticipantId: string;
    readonly kind: string;
    readonly identity: string | null;
  }[];
};
type LeaseRead = (
  identity: CaptureIdentity & { readonly segmentId: string },
) => Promise<{ readonly serverNow: string }>;
const MAX_ADMISSIONS = 4096;
/** An actually bound seat (of `kind`, when named) and the current open segment. */
function requireCurrentSeat(
  capture: CaptureRead,
  roundParticipantId: string,
  segmentId: string,
  kind?: 'bot',
) {
  if (
    !capture.participants.some(
      (seat) =>
        seat.roundParticipantId === roundParticipantId &&
        seat.identity !== null &&
        (kind === undefined || seat.kind === kind),
    )
  )
    throw createAppError('AUTHORIZATION');
  if (capture.segment?.id !== segmentId || capture.segment.endedAt !== null)
    throw createAppError('CONFLICT', 'Activity segment is not current');
}
/**
 * Owner hook for the signed capture ingress. A seat is admitted once per
 * capture lease epoch and segment, by the locked capture read: an actually
 * bound non-judge seat and the current open segment. Admission and every
 * later batch pass the same lease-validity check (`readLease`: epoch,
 * expiry, session end, unsafe or deletion, segment end), read without the
 * Round lock. The receipt is always fresh PostgreSQL time, never the worker
 * body. Redis carries no authority.
 */
export function createBotActivityRelay(input: {
  readonly readCapture: (identity: CaptureIdentity) => Promise<CaptureRead>;
  readonly readLease: LeaseRead;
  readonly write: (batch: unknown) => Promise<void>;
}) {
  const admitted = new Set<string>();
  const admit = async (
    identity: CaptureIdentity,
    roundParticipantId: string,
    segmentId: string,
  ) =>
    requireCurrentSeat(
      await input.readCapture(identity),
      roundParticipantId,
      segmentId,
    );
  return async (identity: CaptureIdentity, body: unknown) => {
    const parsed = botActivityRelaySchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const { roundParticipantId, segmentId, frames } = parsed.data;
    const key = JSON.stringify([identity, roundParticipantId, segmentId]);
    if (!admitted.has(key)) {
      await admit(identity, roundParticipantId, segmentId);
      if (admitted.size === MAX_ADMISSIONS)
        admitted.delete(admitted.values().next().value!);
      admitted.add(key);
    }
    let serverNow: string;
    try {
      ({ serverNow } = await input.readLease({ ...identity, segmentId }));
    } catch (error) {
      admitted.delete(key);
      throw error;
    }
    const batch = botActivityBatchSchema.safeParse({
      version: 1,
      roundId: identity.roundId,
      roundParticipantId,
      frames: frames.map((frame) => ({ ...frame, receivedAt: serverNow })),
    });
    if (!batch.success) throw createAppError('VALIDATION');
    await input.write(batch.data);
  };
}
/**
 * Owner hook for capture's report that it subscribed to a bot seat's track
 * and reads it (ISSUE-514-r2). Each report takes the locked capture read (an
 * actually bound bot seat and the current open segment) and the lease check.
 * Redis carries only the seat for the track: no authority, just when the bot
 * may begin crediting speech.
 */
export function createBotHeardRelay(input: {
  readonly readCapture: (identity: CaptureIdentity) => Promise<CaptureRead>;
  readonly readLease: LeaseRead;
  readonly write: (heard: {
    readonly roundId: string;
    readonly trackId: string;
    readonly seat: string;
  }) => Promise<void>;
}) {
  return async (identity: CaptureIdentity, body: unknown) => {
    const parsed = botHeardRelaySchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const { roundParticipantId, segmentId, trackId } = parsed.data;
    requireCurrentSeat(
      await input.readCapture(identity),
      roundParticipantId,
      segmentId,
      'bot',
    );
    await input.readLease({ ...identity, segmentId });
    await input.write({
      roundId: identity.roundId,
      trackId,
      seat: roundParticipantId,
    });
  };
}
