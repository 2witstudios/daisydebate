import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  judgeMessages,
  parseBallot,
  type Ballot,
} from '@daisy/ai-voice';
import {
  resolveRoomConfiguration as resolveRoom,
  type RoundCommand,
  type RoundProjection,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import {
  practiceRoomConfig,
  referenceAiJudge,
} from '@daisy/db/reference-formats';
import type { RoundHydration } from '@daisy/db';
import type { RoundStore } from './context';
import {
  ownedBy,
  participantIdOf,
  participantRoleOf,
  personSideOf,
  runtimeOf,
  segmentIndexOf,
  transcriptOf,
  aiSideOf,
  type AiDebateDependencies,
  type AiDebateView,
  type AiDebateViewUtterance,
  type AudioFormat,
} from './context';
import { crossExaminationOperations } from './cross-examination';
import { opponentFor, opponentForActor } from './opponents';
import { speechOperations } from './speech';

export type { AiDebateView } from './context';

const DEFAULT_LIMITS = { live: 25, perDay: 20 } as const;

export type PersonCommand =
  | { readonly type: 'start' }
  | { readonly type: 'startPrep' }
  | { readonly type: 'startSpeech' }
  | { readonly type: 'yield' }
  | { readonly type: 'abort' };

const tidy = (resolution: string) => resolution.trim().replace(/\s+/g, ' ');

/**
 * The command log's payload digest: SHA3-256 over the command's content
 * (ADR 0019). The runtime refuses by state rather than payload, so the
 * type alone is the content today; a payload-carrying command widens this
 * input, never the encoding.
 */
const digestOf = (command: { readonly type: string }): string => {
  const hasher = new Bun.CryptoHasher('sha3-256');
  hasher.update(command.type);
  return hasher.digest('hex');
};

/**
 * Reassembles the ballot contract from its columns, for a judge seat whose
 * ballot is on file; null before any ruling.
 */
type StoredBallot = Awaited<
  ReturnType<AiDebateDependencies['store']['getBallot']>
>;

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

/**
 * The AI practice application operations (AIDB on the one Round model,
 * ADR 0058): a practice Room resolves the one-on-one format against the
 * practice config, seats the person, the bot and the AI judge, and the
 * startRound freeze creates the Round. Every later operation drives the
 * same runtime the durable rows persist, so the person's browser, the bot
 * and the judge are actors on one machine.
 */
export function createAiDebateOperations(dependencies: AiDebateDependencies) {
  const { store, voice, ids, limits = DEFAULT_LIMITS } = dependencies;

  /** Persists one execution; a concurrent writer wins and the caller re-hydrates. */
  const persist = async (
    roundId: string,
    expectedVersion: number,
    command: Parameters<RoundStore['applyRoundExecution']>[0]['command'],
    projection: RoundProjection,
  ): Promise<boolean> => {
    try {
      await store.applyRoundExecution({
        roundId,
        expectedVersion,
        command,
        projection,
      });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Hydrates one of the actor's rounds, materializing whatever time moved:
   * the durable rows are the live interval, so a tick that opened or
   * closed segments is persisted before anything reads position. The
   * instant is the database's, read once here and used for the tick, any
   * command this operation applies, and the view's serverNow — one clock
   * for the whole execution (ADR 0033 §3.2, as amended by ADR 0058).
   */
  const hydrated = async (actorId: string, id: string) => {
    const owned = await ownedBy(store, actorId, id, () => ids.next());
    const { round, runtime } = owned;
    const now = Date.parse(await store.databaseNow());
    const ticked = runtime.tick(new Date(now).toISOString());
    const moved =
      ticked.segmentInserts.length > 0 || ticked.segmentCloses.length > 0;
    if (moved && (await persist(round.id, round.version, null, ticked))) {
      const fresh = await store.getRound(id);
      if (fresh)
        return {
          round: fresh,
          runtime: runtimeOf(fresh, () => ids.next()),
          now,
        };
    }
    return { round, runtime, now };
  };

  /** The usage and allowance writes for one billable AI call. */
  const recordUsage = async (
    roundId: string,
    participantId: string,
    actorId: string,
    usage: {
      readonly kind: 'speech' | 'cross_ex' | 'tts' | 'stt' | 'judging';
      readonly model: string;
      readonly inputTokens?: number | undefined;
      readonly outputTokens?: number | undefined;
      readonly characters?: number | undefined;
      readonly requests?: number | undefined;
    },
  ): Promise<void> => {
    await store.recordAgentRun({
      id: ids.next(),
      roundParticipantId: participantId,
      kind: usage.kind,
      model: usage.model,
      provider: 'openrouter',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      characters: usage.characters,
      requests: usage.requests,
    });
    await store.markReservationCounted({ actorId, roundId });
  };

  const viewOf = async (
    round: RoundHydration,
    now: number,
  ): Promise<AiDebateView> => {
    const personSide = personSideOf(round);
    const opponent = opponentForActor(
      round.participants.find((seat) => seat.role === aiSideOf(personSide))
        ?.actorId,
    );
    const judgeSeat = round.participants.find((seat) => seat.role === 'judge');
    const lines = await store.listRoundUtterances(round.id);
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
    const stored = judgeSeat ? await store.getBallot(judgeSeat.id) : null;
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

  return {
    ...speechOperations(dependencies, hydrated, recordUsage),
    ...crossExaminationOperations(dependencies, hydrated, recordUsage),

    async start({
      actorId,
      resolution,
      personSide,
      opponent: opponentId,
    }: {
      readonly actorId: string;
      readonly resolution: string;
      readonly personSide: 'affirmative' | 'negative';
      /** The Train bot to debate. */
      readonly opponent: string;
    }): Promise<{ readonly id: string }> {
      const trimmed = tidy(resolution);
      if (trimmed.length < 3 || trimmed.length > 200)
        throw createAppError('VALIDATION', 'Resolution length');
      const opponent = opponentFor(opponentId);
      if (!opponent) throw createAppError('VALIDATION', 'Unknown opponent');
      voice(); // refuse before writing anything when AI debates are unavailable
      const now = Date.parse(await store.databaseNow());
      const recent = await store.countRecentAiPractice({
        actorId,
        since: new Date(now - 24 * 60 * 60_000),
      });
      if (recent >= limits.perDay)
        throw createAppError('RATE_LIMIT', 'Daily AI debate limit');
      const format = await store.getFormat('one-on-one');
      if (!format)
        throw createAppError('INFRASTRUCTURE', 'The format is missing');
      const resolved = resolveRoom(format.definition, practiceRoomConfig);
      if (!resolved.ok)
        throw createAppError(
          'INFRASTRUCTURE',
          `The practice room refuses to resolve: ${resolved.refusal.message}`,
        );
      const roomId = ids.next();
      await store.createRoom({
        id: roomId,
        formatId: format.id,
        formatVersion: format.version,
        presetVersion: null,
        competitionType: 'practice',
        length: 'full',
        config: practiceRoomConfig,
        executionPlan: resolved.roomPlan,
        rules: resolved.rules,
      });
      await store.seatRoomParticipant({
        roomId,
        participantId: ids.next(),
        actorId,
        role: personSide,
        slot: 0,
      });
      await store.seatRoomParticipant({
        roomId,
        participantId: ids.next(),
        actorId: opponent.actorId,
        role: aiSideOf(personSide),
        slot: 0,
      });
      await store.seatRoomParticipant({
        roomId,
        participantId: ids.next(),
        actorId: referenceAiJudge.actorId,
        role: 'judge',
        slot: 0,
      });
      const roundId = ids.next();
      await store.startRound({ roomId, roundId, resolution: trimmed });
      await store.reserveAiPractice({
        id: ids.next(),
        actorId,
        roundId,
      });
      return { id: roundId };
    },

    async view({
      actorId,
      id,
    }: {
      readonly actorId: string;
      readonly id: string;
    }): Promise<AiDebateView> {
      const { round, now } = await hydrated(actorId, id);
      return viewOf(round, now);
    },

    /** Applies one legal command at the server's time, or refuses it. */
    async command({
      actorId,
      id,
      command,
      expectedVersion,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly command: PersonCommand;
      readonly expectedVersion: number;
    }): Promise<void> {
      const { round, runtime, now } = await hydrated(actorId, id);
      const mapped: RoundCommand =
        command.type === 'startPrep'
          ? { type: 'start_prep' }
          : command.type === 'startSpeech'
            ? { type: 'start_speech' }
            : command.type === 'abort'
              ? { type: 'forfeit' }
              : { type: command.type };
      const executed = runtime.execute({
        command: mapped,
        actorId: command.type === 'start' ? null : actorId,
        now: new Date(now).toISOString(),
      });
      const applied = await persist(
        round.id,
        round.version,
        {
          commandId: ids.next(),
          actorId: command.type === 'start' ? null : actorId,
          serviceId: command.type === 'start' ? 'ai-debate' : null,
          type: mapped.type,
          payloadDigest: digestOf(mapped),
          result: { ok: true },
        },
        executed,
      );
      if (!applied) throw createAppError('CONFLICT', 'The round moved on');
    },

    /** Transcribes a chunk of the person's speech into the transcript. */
    async transcribe({
      actorId,
      id,
      segmentIndex,
      audioBase64,
      format,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly segmentIndex: number;
      readonly audioBase64: string;
      readonly format: AudioFormat;
    }): Promise<{ readonly text: string }> {
      const { round, runtime, now } = await hydrated(actorId, id);
      const position = runtime.position(new Date(now).toISOString());
      const open = position.openSegment;
      if (
        !open ||
        open.sequence !== segmentIndex ||
        (open.type === 'speech' && open.side !== personSideOf(round))
      )
        throw createAppError('CONFLICT', 'That segment is not live');
      const row = round.segments.find(
        (segment) => segment.sequence === open.sequence,
      );
      if (!row) throw createAppError('CONFLICT', 'That segment is not open');
      const model = DEFAULT_MODELS.stt;
      const { text } = await voice().transcribe({
        model,
        audioBase64,
        format,
      });
      await recordUsage(id, participantIdOf(round, actorId), actorId, {
        kind: 'stt',
        model,
        requests: 1,
      });
      if (text)
        await store.appendUtterance({
          id: ids.next(),
          roundId: id,
          segmentId: row.id,
          roundParticipantId: participantIdOf(round, actorId),
          text,
        });
      return { text };
    },

    /** The judge's ballot, decided once after the last segment. */
    async ballot({
      actorId,
      id,
    }: {
      readonly actorId: string;
      readonly id: string;
    }): Promise<Ballot> {
      const { round, runtime, now } = await hydrated(actorId, id);
      const judgeSeat = round.participants.find(
        (seat) => seat.role === 'judge',
      );
      if (!judgeSeat)
        throw createAppError('INTERNAL', 'The round has no judge');
      const stored = await store.getBallot(judgeSeat.id);
      if (stored && stored.status === 'submitted') {
        const view = await viewOf(round, now);
        return view.ballot!;
      }
      const position = runtime.position(new Date(now).toISOString());
      if (!position.awaitingBallot)
        throw createAppError('CONFLICT', 'The debate is not over');
      const personSide = personSideOf(round);
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
      await store.submitBallot({
        ballotId: ids.next(),
        judgeParticipantId: judgeSeat.id,
        ballot,
      });
      const completed = runtime.execute({
        command: { type: 'complete', outcome: ballot.winner },
        actorId: null,
        now: new Date(now).toISOString(),
      });
      const applied = await persist(
        round.id,
        round.version,
        {
          commandId: ids.next(),
          actorId: null,
          serviceId: 'ai-judge',
          type: 'complete',
          payloadDigest: digestOf({ type: 'complete' }),
          result: { outcome: ballot.winner },
        },
        completed,
      );
      if (!applied) throw createAppError('CONFLICT', 'The round moved on');
      return ballot;
    },
  };
}

export type AiDebateOperations = ReturnType<typeof createAiDebateOperations>;
