import { CryptoHasher } from 'bun';
import { createAppError } from '@daisy/errors';
import {
  idSchema,
  roundUnjudgedReceiptSchema,
  type RoundProjection,
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
  readonly ballots: unknown;
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

/** A replayed receipt stands only while the Round is still completed without a winner. */
export function requireUnjudgedTerminal(round: {
  readonly status: string;
  readonly outcome: string | null;
}): void {
  if (round.status !== 'completed' || round.outcome !== null)
    throw receiptConflict();
}

/** Casual, zero required judges, no judge seat, every segment played. */
export function requireUnjudgedRound(
  round: HydratedRound,
): asserts round is NonNullable<HydratedRound> {
  if (
    !round ||
    round.competitionType !== 'casual' ||
    round.rules.seats.judge !== 0 ||
    round.segments.some((p) => p.endedAt === null) ||
    round.participants.some((p) => p.role === 'judge')
  )
    throw ineligible();
}

/** The requested freeze, eligible seats, and no ladder, ballot or rating fact. */
export function requireUnjudgedFacts<
  Freeze extends { readonly revision: number },
>(input: {
  readonly freezeRevision: number;
  readonly freeze: Freeze | null | undefined;
  readonly seats: readonly { readonly eligible: boolean }[];
  readonly durable: UnjudgedDurableFacts | undefined;
}): Freeze {
  const { freeze, durable } = input;
  if (
    !freeze ||
    freeze.revision !== input.freezeRevision ||
    input.seats.some((seat) => !seat.eligible) ||
    !durable ||
    durable.ladder_id !== null ||
    !durable.final_segment_ended_at ||
    !durable.transcript_admission_cutoff ||
    durable.ballots ||
    durable.ratings
  )
    throw ineligible();
  return freeze;
}

/** The engine's completion must finish the Round with no winner and no segment change. */
export function requireCompletionProjection(projection: RoundProjection): void {
  if (
    projection.round?.status !== 'completed' ||
    projection.round.outcome !== null ||
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
}) =>
  roundUnjudgedReceiptSchema.parse({
    version: 1,
    ...input,
    status: 'completed',
    outcome: null,
    replayed: false,
  });
