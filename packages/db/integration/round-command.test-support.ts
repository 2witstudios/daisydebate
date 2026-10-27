import { createId } from '@paralleldrive/cuid2';
import type { RoundCommandEnvelope } from '@daisy/protocol';

/** Canonical input data; execution always goes through the actual fenced API. */
export const authoredRoundCommand = (
  author: { readonly roundId: string; readonly actorId: string },
  expectedVersion: number,
  command: RoundCommandEnvelope['command'] = { type: 'start' },
  commandId = createId(),
) => ({
  roundId: author.roundId,
  envelope: { version: 1 as const, commandId, expectedVersion, command },
  principal: { kind: 'human' as const, actorId: author.actorId },
  payloadDigest: 'a'.repeat(64),
  authorize: () => undefined,
});
