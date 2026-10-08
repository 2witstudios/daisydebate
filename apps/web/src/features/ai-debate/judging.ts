import { runtimeOf } from './runtime';
import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  judgeMessages,
  parseBallot,
  type Ballot,
} from '@daisy/ai-voice';
import { createAppError } from '@daisy/errors';
import type { RoundHydration } from '@daisy/db';
import {
  aiSideOf,
  digestOf,
  participantRoleOf,
  personSideOf,
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
    outcome: round.outcome,
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
 * A version conflict writes neither the ballot nor the completion.
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
    const applied = await dependencies.store
      .applyRoundCompletion({
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
      .then(() => true)
      .catch(() => false);
    if (!applied) throw createAppError('CONFLICT', 'The round moved on');
    await dependencies.store.markReservationCounted({
      actorId: input.actorId,
      roundId: input.round.id,
    });
  };

/**
 * The judge's ruling (ADR 0058): decided once after the last segment has
 * spoken, by the AI judge seat and committed with completion atomically.
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
      if (stored && stored.status === 'submitted') {
        if (round.status !== 'completed')
          throw createAppError(
            'INVARIANT',
            'A ballot belongs to a completed round',
          );
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
      });
      return ballot;
    },
  };
};
