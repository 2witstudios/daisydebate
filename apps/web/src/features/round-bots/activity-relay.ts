import { createAppError } from '@daisy/errors';
import {
  botActivityBatchSchema,
  botActivityRelaySchema,
} from '@daisy/protocol/bot-activity';
import {
  requireCurrentSeat,
  type CaptureIdentity,
  type CaptureRead,
  type LeaseRead,
} from '../media-capture/admission';

const MAX_ADMISSIONS = 4096;
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
