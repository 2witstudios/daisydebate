import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

/** The identity a stored Round command row is bound to. */
export type CommandBinding = {
  readonly roundId: string;
  readonly actorId: string | null;
  readonly serviceId: string | null;
  readonly payloadDigest: string;
  readonly type: string;
};

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
    throw createAppError('CONFLICT', 'command-conflict');
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
