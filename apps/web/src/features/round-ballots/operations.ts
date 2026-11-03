import { bindRoundBallotPrincipal } from '@daisy/auth';
import {
  attendanceSettled,
  createRoundRuntime,
  decidePanelCompletion,
  judgingPanelOf,
} from '@daisy/debate-engine';
import type {
  LockedRoundBallotInput,
  LockedRoundBallotContext,
} from '@daisy/db/round-ballot';
import { createAppError, createRefusal } from '@daisy/errors';
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
    if (!result.ok) throw createRefusal('AUTHORIZATION', result.refusal);
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
    attendanceSettled,
    /**
     * The panel's one decision. Only every seat ruling for one side completes
     * here; any other ending, a tie included, is panel completion's to record
     * with its ruling, on maintenance's next pass.
     */
    buildProjection: (context) => {
      const nowMs = Date.parse(context.now);
      const panel = judgingPanelOf(context.panel, nowMs);
      if (panel === null) return null;
      const { completeness, ballots } = context.panel;
      const decision = decidePanelCompletion({
        completeness,
        panel,
        ballots,
        nowMs,
      });
      if (decision.kind !== 'complete' || decision.ruling !== 'ruled')
        return null;
      const projection = createRoundRuntime({
        ...context.round,
        round: context.round,
        nextSegmentId: input.nextSegmentId,
      }).completePanel({ now: context.now, ballots, completeness, panel });
      return {
        ...projection,
        finalization: {
          freezeRevision: context.frozen.revision,
          ballotIds: context.ballots.map((b) => b.id),
        },
      };
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
