import { createAppError } from '@daisy/errors';
import {
  botActivityBatchSchema,
  botActivityRelaySchema,
} from '@daisy/protocol/bot-activity';
import {
  requireCurrentSeat,
  type WorkerSeatRead,
} from '../round-media/worker-seat';

/** The signed bot-listener identity under one listener lease epoch. */
export type ListenerIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
type LeaseRead = (
  identity: ListenerIdentity & { readonly segmentId: string },
) => Promise<{ readonly serverNow: string }>;

const MAX_ADMISSIONS = 4096;
/**
 * Owner hook for the signed bot-listener ingress (ISSUE-764), admitted only
 * by the listener's own lease, never by capture. A seat is admitted once per
 * listener epoch and segment, by the listener read: an actually bound
 * non-judge seat and the current open segment. Admission and every later
 * batch pass the listener lease check (`readLease`: epoch, expiry, session
 * end, unsafe or deletion, segment end). The receipt is always fresh
 * PostgreSQL time, never the worker body. Redis carries no authority.
 */
export function createBotActivityRelay(input: {
  readonly readListener: (
    identity: ListenerIdentity,
  ) => Promise<WorkerSeatRead>;
  readonly readLease: LeaseRead;
  readonly write: (batch: unknown) => Promise<void>;
}) {
  const admitted = new Set<string>();
  const admit = async (
    identity: ListenerIdentity,
    roundParticipantId: string,
    segmentId: string,
  ) =>
    requireCurrentSeat(
      await input.readListener(identity),
      roundParticipantId,
      segmentId,
    );
  return async (identity: ListenerIdentity, body: unknown) => {
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
