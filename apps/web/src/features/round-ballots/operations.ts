import { bindRoundBallotPrincipal } from '@daisy/auth';
import { createRoundRuntime, deriveRoundOutcome } from '@daisy/debate-engine';
import type {
  LockedRoundBallotInput,
  LockedRoundBallotContext,
} from '@daisy/db/round-ballot';
import { createAppError } from '@daisy/errors';
import {
  roundBallotEnvelopeSchema,
  type RoundBallotEnvelope,
  type RoundCommandPrincipal,
  type RoundBallotReceipt,
} from '@daisy/protocol';

type Submission = {
  readonly principal: RoundCommandPrincipal;
  readonly roundId: string;
  readonly envelope: RoundBallotEnvelope;
  readonly nextBallotId: () => string;
  readonly nextSegmentId: () => string;
};
/** Shared preparation for session callers and the D4 result transaction. No preloaded authority or outcomes. */
export function prepareRoundBallotSubmission(
  input: Submission,
): LockedRoundBallotInput {
  const parsed = roundBallotEnvelopeSchema.safeParse(input.envelope);
  if (!parsed.success) throw createAppError('VALIDATION');
  const envelope = parsed.data;
  const authorize = (context: LockedRoundBallotContext) => {
    const result = bindRoundBallotPrincipal({
      principal: input.principal,
      judgeParticipantId: envelope.judgeParticipantId,
      authority: {
        ...context.authority,
        agentRun: context.authority.agentRun
          ? { ...context.authority.agentRun, kind: context.runKind ?? '' }
          : null,
      },
    });
    if (!result.ok) throw createAppError('AUTHORIZATION', result.refusal);
  };
  return {
    roundId: input.roundId,
    principal: input.principal,
    envelope,
    nextBallotId: input.nextBallotId,
    payloadDigest: new Bun.CryptoHasher('sha3-256')
      .update(JSON.stringify(envelope))
      .digest('hex'),
    authorize,
    buildProjection: (context) => {
      const judges = context.round.participants.filter(
        (p) => p.role === 'judge',
      );
      if (context.ballots.length < judges.length) return null;
      const outcome = deriveRoundOutcome(
        context.round.participants,
        context.ballots.map((b) => {
          if (
            (b.winner !== 'affirmative' && b.winner !== 'negative') ||
            (b.status !== 'submitted' && b.status !== 'voided')
          )
            throw createAppError('INVARIANT');
          return {
            judgeParticipantId: b.judgeParticipantId,
            winner: b.winner,
            status: b.status,
          };
        }),
      );
      return createRoundRuntime({
        round: context.round,
        rules: context.round.rules,
        participants: context.round.participants,
        checkpoint: context.round.checkpoint,
        segments: context.round.segments,
        nextSegmentId: input.nextSegmentId,
      }).execute({
        command: { type: 'complete', outcome },
        actorId: null,
        now: context.now,
      });
    },
  };
}
export function createRoundBallotOperations(input: {
  readonly store: {
    readonly executeRoundBallot: (
      input: LockedRoundBallotInput,
    ) => Promise<RoundBallotReceipt>;
  };
  readonly nextBallotId: () => string;
  readonly nextSegmentId: () => string;
}) {
  return {
    submit: (
      principal: RoundCommandPrincipal,
      roundId: string,
      envelope: RoundBallotEnvelope,
    ) =>
      input.store.executeRoundBallot(
        prepareRoundBallotSubmission({
          ...input,
          principal,
          roundId,
          envelope,
        }),
      ),
  };
}
