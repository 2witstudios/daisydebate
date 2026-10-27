import { createAppError } from '@daisy/errors';
import {
  botActivityBatchSchema,
  botActivityRelaySchema,
} from '@daisy/protocol/bot-activity';

/** The signed bot-listener identity under one listener lease epoch. */
export type ListenerIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
/** The listener's own read: the open segment and the non-judge seats. */
type ListenerRead = {
  readonly segment: {
    readonly id: string;
    readonly endedAt: string | null;
  } | null;
  readonly participants: readonly {
    readonly roundParticipantId: string;
    readonly identity: string | null;
  }[];
};
type LeaseRead = (
  identity: ListenerIdentity & { readonly segmentId: string },
) => Promise<{ readonly serverNow: string }>;

/** An actually bound seat and the current open segment. */
function requireBoundSeat(
  read: ListenerRead,
  roundParticipantId: string,
  segmentId: string,
) {
  if (
    !read.participants.some(
      (seat) =>
        seat.roundParticipantId === roundParticipantId &&
        seat.identity !== null,
    )
  )
    throw createAppError('AUTHORIZATION');
  if (read.segment?.id !== segmentId || read.segment.endedAt !== null)
    throw createAppError('CONFLICT', 'Activity segment is not current');
}

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
  readonly readListener: (identity: ListenerIdentity) => Promise<ListenerRead>;
  readonly readLease: LeaseRead;
  readonly write: (batch: unknown) => Promise<void>;
}) {
  const admitted = new Set<string>();
  const admit = async (
    identity: ListenerIdentity,
    roundParticipantId: string,
    segmentId: string,
  ) =>
    requireBoundSeat(
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
