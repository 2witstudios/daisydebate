import { CryptoHasher } from 'bun';
import { createAppError } from '@daisy/errors';
import {
  idSchema,
  roundUnjudgedReceiptSchema,
  type RoundProjection,
  type RoundUnjudgedReceipt,
} from '@daisy/protocol';
import type { hydrateRoundRows } from './round-hydration';
import type { roundCommands } from './schema/round-commands';

/** The identity of one internal zero-judge completion request. */
export type UnjudgedRequest = {
  readonly instanceId: string;
  readonly commandId: string;
  readonly roundId: string;
  readonly freezeRevision: number;
};
type CommandRow = typeof roundCommands.$inferSelect;
type HydratedRound = Awaited<ReturnType<typeof hydrateRoundRows>>;
/** Durable Round facts read under the Round lock. */
export type UnjudgedDurableFacts = {
  readonly ladder_id: unknown;
  readonly final_segment_ended_at: unknown;
  readonly transcript_admission_cutoff: unknown;
  readonly ballot_deadline_at: unknown;
  readonly ratings: unknown;
};

const ineligible = () => createAppError('CONFLICT', 'unjudged-ineligible');
const receiptConflict = () =>
  createAppError('CONFLICT', 'unjudged-receipt-conflict');

export function requireUnjudgedRequest(input: UnjudgedRequest): void {
  if (
    ![input.instanceId, input.commandId, input.roundId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !Number.isSafeInteger(input.freezeRevision) ||
    input.freezeRevision < 1
  )
    throw createAppError('VALIDATION');
}

/** Binds a command row to this Round and frozen revision, never to the caller. */
export const unjudgedDigest = (input: UnjudgedRequest) =>
  new CryptoHasher('sha3-256')
    .update(
      JSON.stringify({
        purpose: 'complete-unjudged',
        roundId: input.roundId,
        freezeRevision: input.freezeRevision,
      }),
    )
    .digest('hex');

function requireReceiptCommand(
  row: CommandRow,
  input: UnjudgedRequest,
  digest: string,
) {
  if (
    row.roundId !== input.roundId ||
    row.type !== 'complete' ||
    row.actorId !== null ||
    !row.serviceId?.startsWith('round-finalization:') ||
    row.payloadDigest !== digest
  )
    throw receiptConflict();
}

/** A stored completion replays only if it is this service's exact zero-judge receipt. */
export function validateUnjudgedReceipt(
  row: CommandRow,
  input: UnjudgedRequest,
  digest: string,
) {
  requireReceiptCommand(row, input, digest);
  const receipt = roundUnjudgedReceiptSchema.parse(row.result);
  if (
    receipt.roundId !== input.roundId ||
    receipt.freezeRevision !== input.freezeRevision ||
    receipt.commandId !== row.commandId ||
    receipt.resultingVersion !== row.resultingVersion
  )
    throw receiptConflict();
  return receipt;
}

/** The ruling of the Round's unjudged completion receipt among its command rows, or null when it has none. */
export function recordedUnjudgedRuling(
  rows: readonly Pick<
    CommandRow,
    'type' | 'actorId' | 'serviceId' | 'result'
  >[],
): RoundUnjudgedReceipt['ruling'] | null {
  for (const row of rows) {
    if (
      row.type !== 'complete' ||
      row.actorId !== null ||
      !row.serviceId?.startsWith('round-finalization:')
    )
      continue;
    const receipt = roundUnjudgedReceiptSchema.safeParse(row.result);
    if (receipt.success) return receipt.data.ruling;
  }
  return null;
}

/** A replayed receipt stands only while the Round is still completed with its recorded outcome. */
export function requireUnjudgedTerminal(
  round: { readonly status: string; readonly outcome: string | null },
  recorded: string | null,
): void {
  if (round.status !== 'completed' || round.outcome !== recorded)
    throw receiptConflict();
}

/** A casual Round with every segment played; its judges, if any, may not have ruled. */
export function requireUnjudgedRound(
  round: HydratedRound,
): asserts round is NonNullable<HydratedRound> {
  if (
    !round ||
    round.competitionType !== 'casual' ||
    round.segments.some((p) => p.endedAt === null)
  )
    throw ineligible();
}

/**
 * The requested freeze, eligible debaters and no ladder or rating fact. A
 * judge who left cannot hold the Round open: the deadline records no ruling.
 * Returns the freeze and the ballot deadline persisted at it, as UTC ISO.
 */
export function requireUnjudgedFacts<
  Freeze extends { readonly revision: number },
>(input: {
  readonly freezeRevision: number;
  readonly freeze: Freeze | null | undefined;
  readonly seats: readonly {
    readonly role: string;
    readonly eligible: boolean;
  }[];
  readonly durable: UnjudgedDurableFacts | undefined;
}): { readonly freeze: Freeze; readonly ballotDeadlineAt: string | null } {
  const { freeze, durable } = input;
  if (
    !freeze ||
    freeze.revision !== input.freezeRevision ||
    input.seats.some((seat) => seat.role !== 'judge' && !seat.eligible) ||
    !durable ||
    durable.ladder_id !== null ||
    !durable.final_segment_ended_at ||
    !durable.transcript_admission_cutoff ||
    durable.ratings
  )
    throw ineligible();
  return {
    freeze,
    ballotDeadlineAt: durable.ballot_deadline_at
      ? new Date(durable.ballot_deadline_at as string).toISOString()
      : null,
  };
}

/**
 * The engine's completion finishes the Round with no segment change, and
 * names a winner exactly when some judges ruled (`partial`).
 */
export function requireCompletionProjection(completion: {
  readonly projection: RoundProjection;
  readonly ruling: RoundUnjudgedReceipt['ruling'];
}): void {
  const { projection } = completion;
  if (
    projection.round?.status !== 'completed' ||
    (completion.ruling !== 'partial') !== (projection.round.outcome === null) ||
    projection.segmentInserts.length ||
    projection.segmentCloses.length
  )
    throw createAppError('CONFLICT', 'unjudged-projection');
}

export const unjudgedReceipt = (input: {
  readonly commandId: string;
  readonly roundId: string;
  readonly freezeRevision: number;
  readonly resultingVersion: number;
  readonly ruling: RoundUnjudgedReceipt['ruling'];
  readonly outcome: RoundUnjudgedReceipt['outcome'];
  readonly noRuling: readonly string[];
}) =>
  roundUnjudgedReceiptSchema.parse({
    version: 1,
    ...input,
    status: 'completed',
    replayed: false,
  });
