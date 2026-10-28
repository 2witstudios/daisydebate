import { createAppError } from '@daisy/errors';
import { captureHeardReportSchema } from '@daisy/protocol/capture-heard';
import {
  requireCurrentSeat,
  type CaptureIdentity,
  type CaptureRead,
  type LeaseRead,
} from './admission';

/**
 * Capture's own report that it subscribed to a bot seat's track and reads
 * it (DEC-226, ISSUE-514-r2). Each report takes the locked capture read (an
 * actually bound bot seat and the current open segment) and the lease check.
 * Redis carries only the seat for the track: no authority, just when the bot
 * may begin crediting speech.
 */
export function createCaptureHeardRelay(input: {
  readonly readCapture: (identity: CaptureIdentity) => Promise<CaptureRead>;
  readonly readLease: LeaseRead;
  readonly write: (heard: {
    readonly roundId: string;
    readonly trackId: string;
    readonly seat: string;
  }) => Promise<void>;
}) {
  return async (identity: CaptureIdentity, body: unknown) => {
    const parsed = captureHeardReportSchema.safeParse(body);
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
