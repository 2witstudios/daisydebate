import { createAppError } from '@daisy/errors';
import { storedCommand } from './command-log';
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
export const storedRoundCommand = (
  tx: Tx,
  commandId: string,
  expected: CommandBinding,
) => storedCommand(tx, roundCommands, commandId, expected);

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

/**
 * The distinct actors a Round write fences, seats first, in a stable order.
 * Absent optional actors are skipped.
 */
export const fencedActorIds = (
  seats: readonly { readonly actorId: string }[],
  ...extra: readonly (string | null | undefined)[]
): string[] => [
  ...new Set([
    ...seats.map((seat) => seat.actorId),
    ...extra.filter((id): id is string => !!id),
  ]),
];
