import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  judgeMessages,
  parseBallot,
  type Ballot,
} from '@daisy/ai-voice';
import { ballotSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { RoundHydration } from '@daisy/db';
import {
  aiSideOf,
  digestOf,
  participantRoleOf,
  personSideOf,
  runtimeOf,
  segmentIndexOf,
  transcriptOf,
  type AiDebateDependencies,
  type AiDebateView,
  type AiDebateViewUtterance,
  type RecordUsage,
} from './context';
import { opponentForActor } from './opponents';

/** The hydrated round a read or write operation starts from. */
type Hydrated = {
  readonly round: RoundHydration;
  readonly runtime: ReturnType<typeof runtimeOf>;
  readonly now: number;
};

type StoredBallot = Awaited<
  ReturnType<AiDebateDependencies['store']['getBallot']>
>;

/**
 * Reassembles the ballot contract from its columns, for a judge seat whose
 * ballot is on file; null before any ruling.
 */
const ballotOf = (stored: StoredBallot) =>
  stored && stored.status === 'submitted'
    ? parseBallot(
        JSON.stringify({
          rubricVersion: stored.rubricVersion,
          winner: stored.winner,
          scores: stored.scores,
          reason: stored.reason,
          feedback: stored.feedback ?? {},
          ...(stored.citations ? { citations: stored.citations } : {}),
        }),
      )
    : null;

/** The hydration view one of the actor's live rounds carries. */
export const viewOf = async (
  dependencies: AiDebateDependencies,
  round: RoundHydration,
  now: number,
  actorId: string,
): Promise<AiDebateView> => {
  const personSide = personSideOf(round, actorId);
  const opponent = opponentForActor(
    round.participants.find((seat) => seat.role === aiSideOf(personSide))
      ?.actorId,
  );
  const judgeSeat = round.participants.find((seat) => seat.role === 'judge');
  const lines = await dependencies.store.listRoundUtterances(round.id);
  const utterances: AiDebateViewUtterance[] = lines.map((line) => {
    const role = participantRoleOf(round, line.roundParticipantId);
    return {
      id: line.id,
      segmentIndex: segmentIndexOf(round, line.segmentId),
      role: role === personSide ? 'person' : 'ai',
      text: line.text,
      complete: line.complete,
      at: line.createdAt.getTime(),
    };
  });
  const stored = judgeSeat
    ? await dependencies.store.getBallot(judgeSeat.id)
    : null;
  return {
    id: round.id,
    resolution: round.resolution,
    personSide,
    opponent: opponent?.id ?? '',
    voice: opponent?.voice ?? 'aura-2-thalia-en',
    serverNow: now,
    version: round.version,
    status: round.status,
    startedAt: round.startedAt === null ? null : Date.parse(round.startedAt),
    rules: round.rules,
    segments: round.segments,
    checkpoint: round.checkpoint,
    utterances,
    ballot: ballotOf(stored),
  };
};

/**
 * Records the judge's ruling and completes the round together.
 *
 * These used to be two commits with the completion second, and the completion
 * is the one that can lose to a concurrent write — which left a ballot on file
 * against a round still `active`, and the retry returned the stored ballot
 * without ever completing the round. `applyRoundCompletion` refuses with
 * CONFLICT and writes nothing, so a lost race costs a retry rather than
 * stranding the round.
 */
const completeWithBallot =
  (dependencies: AiDebateDependencies) =>
  async (input: {
    readonly round: RoundHydration;
    readonly runtime: ReturnType<typeof runtimeOf>;
    readonly now: number;
    readonly judgeSeatId: string;
    readonly actorId: string;
    readonly ballot: Ballot;
    readonly ballotId: string;
    /**
     * False when the ruling is already on file and only the completion is
     * missing, which is what the recovery path is for: the ballot is durable
     * already, so it must not be written a second time.
     */
    readonly writeBallot: boolean;
  }): Promise<void> => {
    const completed = input.runtime.execute({
      command: { type: 'complete', outcome: input.ballot.winner },
      actorId: null,
      now: new Date(input.now).toISOString(),
    });
    const command = {
      commandId: dependencies.ids.next(),
      actorId: null,
      serviceId: 'ai-judge',
      type: 'complete' as const,
      payloadDigest: digestOf({ type: 'complete' }),
      result: { outcome: input.ballot.winner },
    };
    const applied = await (
      input.writeBallot
        ? dependencies.store.applyRoundCompletion({
            roundId: input.round.id,
            expectedVersion: input.round.version,
            ballot: {
              ballotId: input.ballotId,
              judgeParticipantId: input.judgeSeatId,
              ballot: input.ballot,
            },
            command,
            projection: completed,
          })
        : dependencies.store.applyRoundExecution({
            roundId: input.round.id,
            expectedVersion: input.round.version,
            command,
            projection: completed,
          })
    )
      .then(() => true)
      .catch(() => false);
    if (!applied) throw createAppError('CONFLICT', 'The round moved on');
    await dependencies.store.markReservationCounted({
      actorId: input.actorId,
      roundId: input.round.id,
    });
  };

/**
 * The judge's ruling (ADR 0058): decided once, after the last segment has
 * spoken, by the AI judge seat. A ruling already on file against a round the
 * database still calls `active` is recovered — the ballot landed and the
 * completion did not — by completing the round from the stored ruling rather
 * than judging twice.
 */
export const judgingOperations = (
  dependencies: AiDebateDependencies,
  hydrated: (actorId: string, id: string) => Promise<Hydrated>,
  recordUsage: RecordUsage,
) => {
  const complete = completeWithBallot(dependencies);
  const projectView = (
    round: RoundHydration,
    now: number,
    actorId: string,
  ): Promise<AiDebateView> => viewOf(dependencies, round, now, actorId);
  return {
    /** The judge's ballot, decided once after the last segment. */
    async ballot({
      actorId,
      id,
    }: {
      readonly actorId: string;
      readonly id: string;
    }): Promise<Ballot> {
      const { store, voice } = dependencies;
      const { round, runtime, now } = await hydrated(actorId, id);
      const judgeSeat = round.participants.find(
        (seat) => seat.role === 'judge',
      );
      if (!judgeSeat)
        throw createAppError('INTERNAL', 'The round has no judge');
      const stored = await store.getBallot(judgeSeat.id);
      const position = runtime.position(new Date(now).toISOString());
      // The durable status decides, not the derived position. A ruling on file
      // against a round the database still calls `active` means the ballot
      // landed and the completion did not — which used to strand the round for
      // good, because this path returned the stored ruling and never completed
      // it. `applyRoundCompletion` writes both or neither, so this can only be
      // a round left by the old two-commit path; completing it now is the
      // recovery, and it skips the model call because the ruling is stored.
      if (stored && stored.status === 'submitted') {
        if (round.status === 'completed') {
          const view = await projectView(round, now, actorId);
          return view.ballot!;
        }
        // Re-validated on the way out of the database: the columns are nullable
        // and the contract is not, so a row that cannot satisfy the schema is
        // a corrupt ruling rather than a round to complete from.
        await complete({
          round,
          runtime,
          now,
          judgeSeatId: judgeSeat.id,
          actorId,
          ballot: ballotSchema.parse({
            rubricVersion: stored.rubricVersion,
            winner: stored.winner,
            scores: stored.scores,
            reason: stored.reason,
            feedback: stored.feedback,
            citations: stored.citations ?? undefined,
          }),
          ballotId: dependencies.ids.next(),
          writeBallot: false,
        });
        const view = await projectView(round, now, actorId);
        return view.ballot!;
      }
      if (!position.awaitingBallot)
        throw createAppError('CONFLICT', 'The debate is not over');
      const personSide = personSideOf(round, actorId);
      const lines = await store.listRoundUtterances(id);
      const transcript = transcriptOf(
        round.rules,
        lines.map((line) => ({
          id: line.id,
          segmentIndex: segmentIndexOf(round, line.segmentId),
          role:
            participantRoleOf(round, line.roundParticipantId) === personSide
              ? ('person' as const)
              : ('ai' as const),
          text: line.text,
          complete: line.complete,
          at: line.createdAt.getTime(),
        })),
      );
      const answer = await voice().complete({
        model: DEFAULT_MODELS.judge,
        messages: judgeMessages({
          resolution: round.resolution,
          personSide,
          transcript,
        }),
        maxTokens: 6_000,
        temperature: 0.2,
        json: true,
        reasoning: DEFAULT_REASONING.judge,
      });
      await recordUsage(id, judgeSeat.id, actorId, {
        kind: 'judging',
        model: DEFAULT_MODELS.judge,
        inputTokens: answer.promptTokens,
        outputTokens: answer.completionTokens,
      });
      const ballot = parseBallot(answer.text);
      await complete({
        round,
        runtime,
        now,
        judgeSeatId: judgeSeat.id,
        actorId,
        ballot,
        ballotId: dependencies.ids.next(),
        writeBallot: true,
      });
      return ballot;
    },
  };
};
