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
/**
 * Owner hook for the signed capture ingress. The current capture lease and
 * an actual bound non-judge seat precede relay; the receipt is fresh
 * PostgreSQL time, never the worker body. Redis carries no authority.
 */
export function createBotActivityRelay(input: {
  readonly readCapture: (identity: CaptureIdentity) => Promise<{
    readonly serverNow: string;
    readonly participants: readonly {
      readonly roundParticipantId: string;
      readonly identity: string | null;
    }[];
  }>;
  readonly write: (batch: unknown) => Promise<void>;
}) {
  return async (identity: CaptureIdentity, body: unknown) => {
    const parsed = botActivityRelaySchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const { roundParticipantId, frames } = parsed.data;
    const capture = await input.readCapture(identity);
    if (
      !capture.participants.some(
        (seat) =>
          seat.roundParticipantId === roundParticipantId &&
          seat.identity !== null,
      )
    )
      throw createAppError('AUTHORIZATION');
    const batch = botActivityBatchSchema.safeParse({
      version: 1,
      roundId: identity.roundId,
      roundParticipantId,
      frames: frames.map((frame) => ({
        ...frame,
        receivedAt: capture.serverNow,
      })),
    });
    if (!batch.success) throw createAppError('VALIDATION');
    await input.write(batch.data);
  };
}
