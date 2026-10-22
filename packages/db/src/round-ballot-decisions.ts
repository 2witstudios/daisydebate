import { createAppError } from '@daisy/errors';
import type {
  RoundBallotEnvelope,
  RoundBallotReceipt,
  RoundCommandPrincipal,
} from '@daisy/protocol';

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
    throw createAppError('CONFLICT', 'freeze-not-ready');
  return frozen;
}

/** A new ballot needs the expected version, an undecided Round and an unused judge seat. */
export function requireBallotAdmission(input: {
  readonly version: number;
  readonly expectedVersion: number;
  readonly round: { readonly status: string; readonly outcome: string | null };
  readonly submittedJudgeIds: readonly string[];
  readonly judgeParticipantId: string;
}): void {
  if (input.version !== input.expectedVersion)
    throw createAppError('CONFLICT', 'stale-version');
  if (input.round.status !== 'active' || input.round.outcome !== null)
    throw createAppError('CONFLICT', 'round-decided');
  if (input.submittedJudgeIds.includes(input.judgeParticipantId))
    throw createAppError('CONFLICT', 'ballot-already-submitted');
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
