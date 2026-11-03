import { createAppError, createRefusal } from '@daisy/errors';
import { captureWithinLimit } from '@daisy/protocol';
import type {
  RoundBallotEnvelope,
  RoundBallotReceipt,
  RoundCommandPrincipal,
} from '@daisy/protocol';

/**
 * An AI judge rules only on what can be judged (DEC-208, ADR 0110): a complete transcript,
 * or one whose stated gap is within the limit. A job is never queued for anything else,
 * and this holds if one ever is, since rating trusts the ballot.
 */
export function requireAgentBallotCapture(
  principal: RoundCommandPrincipal,
  frozen: {
    readonly completeness: string;
    readonly captureGapMs: number | null;
    readonly expectedSpeechMs: number;
  },
): void {
  if (
    principal.kind === 'agent' &&
    frozen.completeness !== 'complete' &&
    !captureWithinLimit({
      gapMs: frozen.captureGapMs,
      expectedMs: frozen.expectedSpeechMs,
    })
  )
    throw createAppError(
      'INVARIANT',
      'An AI judge cannot rule on an incomplete transcript',
    );
}

/** A bot ballot needs a lease check and the live judging run for this exact job. */
export function requireJudgingRun(
  input: {
    readonly roundId: string;
    readonly principal: RoundCommandPrincipal;
    readonly envelope: Pick<
      RoundBallotEnvelope,
      'judgeParticipantId' | 'freezeRevision'
    >;
    readonly leased: boolean;
  },
  run: {
    readonly runKind: string | null;
    readonly runConfiguration: Record<string, unknown> | null;
  },
): void {
  if (input.principal.kind !== 'agent') return;
  const config = run.runConfiguration;
  if (
    !input.leased ||
    run.runKind !== 'judging' ||
    config?.roundId !== input.roundId ||
    config.judgeParticipantId !== input.envelope.judgeParticipantId ||
    config.freezeRevision !== input.envelope.freezeRevision ||
    !Number.isSafeInteger(config.jobEpoch) ||
    Number(config.jobEpoch) <= 0
  )
    throw createAppError('AUTHORIZATION');
}

/** Ballots judge only the exact frozen revision they name. */
export function requireFrozenRevision<
  Frozen extends { readonly revision: number },
>(frozen: Frozen | null | undefined, freezeRevision: number): Frozen {
  if (!frozen || frozen.revision !== freezeRevision)
    throw createRefusal('CONFLICT', 'freeze-not-ready');
  return frozen;
}

/**
 * A new ballot needs the expected version, an undecided Round still before
 * its persisted ballot deadline by the database clock (DEC-207), and an
 * unused judge seat.
 */
export function requireBallotAdmission(input: {
  readonly version: number;
  readonly expectedVersion: number;
  readonly round: { readonly status: string; readonly outcome: string | null };
  readonly submittedJudgeIds: readonly string[];
  readonly judgeParticipantId: string;
  readonly now: string;
  readonly ballotDeadlineAt: Date | null;
}): void {
  if (input.version !== input.expectedVersion)
    throw createRefusal('CONFLICT', 'stale-version');
  if (input.round.status !== 'active' || input.round.outcome !== null)
    throw createRefusal('CONFLICT', 'round-decided');
  if (
    input.ballotDeadlineAt &&
    Date.parse(input.now) >= input.ballotDeadlineAt.getTime()
  )
    throw createRefusal('CONFLICT', 'round-decided');
  if (input.submittedJudgeIds.includes(input.judgeParticipantId))
    throw createRefusal('CONFLICT', 'ballot-already-submitted');
}

/** The version only advances when the engine projection changed the Round. */
export const ballotReceipt = (input: {
  readonly commandId: string;
  readonly roundId: string;
  readonly ballotId: string;
  readonly judgeParticipantId: string;
  readonly freezeRevision: number;
  readonly version: number;
  readonly changed: boolean;
  readonly outcome: RoundBallotReceipt['outcome'] | undefined;
}): RoundBallotReceipt => ({
  commandId: input.commandId,
  roundId: input.roundId,
  ballotId: input.ballotId,
  judgeParticipantId: input.judgeParticipantId,
  freezeRevision: input.freezeRevision,
  resultingVersion: input.version + (input.changed ? 1 : 0),
  outcome: input.outcome ?? null,
});
