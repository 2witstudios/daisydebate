import { eq } from 'drizzle-orm';
import { createAppError, createRefusal } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { roundCommands } from './schema/round-commands';
import type { Tx } from './tx';

/** The identity a stored Round command row is bound to. */
export type CommandBinding = {
  readonly roundId: string;
  readonly actorId: string | null;
  readonly serviceId: string | null;
  readonly payloadDigest: string;
  readonly type: string;
};

/**
 * The Round command record (`round_commands`): a Round write's idempotency
 * and audit row, read under the `roundCommand` advisory lock its writer
 * already holds. A stored row is returned only when it binds the exact same
 * Round, principal, type and payload; a reused id with anything else refuses.
 */
export async function storedRoundCommand(
  tx: Tx,
  commandId: string,
  expected: CommandBinding,
) {
  const [previous] = await tx
    .select()
    .from(roundCommands)
    .where(eq(roundCommands.commandId, commandId));
  if (previous) requireSameCommand(previous, expected);
  return previous ?? null;
}

/** A reused command id replays only for the exact same Round, principal, type and payload. */
export function requireSameCommand(
  previous: CommandBinding,
  expected: CommandBinding,
): void {
  if (
    previous.roundId !== expected.roundId ||
    previous.actorId !== expected.actorId ||
    previous.serviceId !== expected.serviceId ||
    previous.payloadDigest !== expected.payloadDigest ||
    previous.type !== expected.type
  )
    throw createRefusal('CONFLICT', 'command-conflict');
}

/** A Round write names a cuid2 Round, a schema-valid envelope and a SHA3-256 hex digest. */
export function requireCommandInput(
  input: {
    readonly roundId: string;
    readonly envelope: unknown;
    readonly payloadDigest: string;
  },
  envelope: { readonly safeParse: (value: unknown) => { success: boolean } },
): void {
  if (
    !idSchema.safeParse(input.roundId).success ||
    !envelope.safeParse(input.envelope).success ||
    !/^[0-9a-f]{64}$/.test(input.payloadDigest)
  )
    throw createAppError('VALIDATION');
}

/** A seat that appeared after the account fence was taken refuses the write. */
export function requireFencedParticipants(
  participants: readonly { readonly actorId: string }[],
  fencedActorIds: readonly string[],
): void {
  if (participants.some((seat) => !fencedActorIds.includes(seat.actorId)))
    throw createAppError('CONFLICT');
}
