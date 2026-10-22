import { createAppError } from '@daisy/errors';
import {
  botActivityBatchSchema,
  botActivityRelaySchema,
} from '@daisy/protocol/bot-activity';

type CaptureIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
const MAX_ADMISSIONS = 4096;
/**
 * Owner hook for the signed capture ingress. A seat is admitted once per
 * capture lease epoch and segment, by the locked capture read: the current
 * lease, an actually bound non-judge seat and the current open segment.
 * Later batches need only a current lease, read without the Round lock. The
 * receipt is always fresh PostgreSQL time, never the worker body. Redis
 * carries no authority.
 */
export function createBotActivityRelay(input: {
  readonly readCapture: (identity: CaptureIdentity) => Promise<{
    readonly serverNow: string;
    readonly segment: {
      readonly id: string;
      readonly endedAt: string | null;
    } | null;
    readonly participants: readonly {
      readonly roundParticipantId: string;
      readonly identity: string | null;
    }[];
  }>;
  readonly readLease: (
    identity: CaptureIdentity & { readonly segmentId: string },
  ) => Promise<{ readonly serverNow: string }>;
  readonly write: (batch: unknown) => Promise<void>;
}) {
  const admitted = new Set<string>();
  const admit = async (
    identity: CaptureIdentity,
    roundParticipantId: string,
    segmentId: string,
  ) => {
    const capture = await input.readCapture(identity);
    if (
      !capture.participants.some(
        (seat) =>
          seat.roundParticipantId === roundParticipantId &&
          seat.identity !== null,
      )
    )
      throw createAppError('AUTHORIZATION');
    if (capture.segment?.id !== segmentId || capture.segment.endedAt !== null)
      throw createAppError('CONFLICT', 'Activity segment is not current');
    return capture.serverNow;
  };
  return async (identity: CaptureIdentity, body: unknown) => {
    const parsed = botActivityRelaySchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const { roundParticipantId, segmentId, frames } = parsed.data;
    const key = JSON.stringify([identity, roundParticipantId, segmentId]);
    let serverNow: string;
    if (admitted.has(key)) {
      try {
        ({ serverNow } = await input.readLease({ ...identity, segmentId }));
      } catch (error) {
        admitted.delete(key);
        throw error;
      }
    } else {
      serverNow = await admit(identity, roundParticipantId, segmentId);
      if (admitted.size === MAX_ADMISSIONS)
        admitted.delete(admitted.values().next().value!);
      admitted.add(key);
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
