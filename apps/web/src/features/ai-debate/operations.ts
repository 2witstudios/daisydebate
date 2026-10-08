import { ownedBy, runtimeOf } from './runtime';
import { DEFAULT_MODELS } from '@daisy/ai-voice';
import type {
  RoundCommand,
  RoundPosition,
  RoundProjection,
} from '@daisy/debate-engine';
import { createAppError, isAppError } from '@daisy/errors';
import type { RoundStore } from './context';
import {
  aiSideOf,
  digestOf,
  participantIdOf,
  personSideOf,
  type AiDebateDependencies,
  type AiDebateView,
  type AudioFormat,
  type RecordUsage,
} from './context';
import { crossExaminationOperations } from './cross-examination';
import { judgingOperations, viewOf } from './judging';
import { speechOperations } from './speech';
import { startPractice } from './start-practice';

export type { AiDebateView } from './context';

const DEFAULT_LIMITS = { live: 25, perDay: 20 } as const;

export type PersonCommand =
  | { readonly type: 'start' }
  | { readonly type: 'startPrep' }
  | { readonly type: 'startSpeech' }
  | { readonly type: 'interrupt' }
  | { readonly type: 'yield'; readonly segmentIndex: number }
  | { readonly type: 'abort' };

const requireYieldSegment = (
  command: PersonCommand,
  position: RoundPosition,
): void => {
  if (
    command.type === 'yield' &&
    position.openSegment?.sequence !== command.segmentIndex
  )
    throw createAppError('CONFLICT', 'That segment is not live');
};

const actingActorOf = (
  round: Awaited<ReturnType<RoundStore['getRound']>>,
  actorId: string,
  command: RoundCommand,
  position: RoundPosition,
): string => {
  if (!round || command.type !== 'yield') return actorId;
  const open = position.openSegment;
  if (!open) return actorId;
  if (open.floorParticipantId)
    return (
      round.participants.find((seat) => seat.id === open.floorParticipantId)
        ?.actorId ?? actorId
    );
  const botSide = aiSideOf(personSideOf(round, actorId));
  return open.side === botSide
    ? (round.participants.find((seat) => seat.role === botSide)?.actorId ??
        actorId)
    : actorId;
};

const requireBotLine = async (
  store: RoundStore,
  round: NonNullable<Awaited<ReturnType<RoundStore['getRound']>>>,
  position: RoundPosition,
  acting: string,
): Promise<void> => {
  const botSeat = round.participants.find((seat) => seat.actorId === acting);
  const openRow = round.segments.find(
    (segment) => segment.sequence === position.openSegment?.sequence,
  );
  const lines = await store.listRoundUtterances(round.id);
  if (
    !botSeat ||
    !openRow ||
    !lines.some(
      (line) =>
        line.segmentId === openRow.id &&
        line.roundParticipantId === botSeat.id &&
        line.complete,
    )
  )
    throw createAppError('CONFLICT', 'The AI has not finished its turn');
};

const mappedCommand = (command: PersonCommand): RoundCommand => {
  if (command.type === 'startPrep') return { type: 'start_prep' };
  if (command.type === 'startSpeech') return { type: 'start_speech' };
  if (command.type === 'abort') return { type: 'forfeit' };
  return { type: command.type };
};

/** Accept a clip on the database clock, including the recorder's final flush. */
const recordedSegmentOf = (
  round: NonNullable<Awaited<ReturnType<RoundStore['getRound']>>>,
  actorId: string,
  segmentIndex: number,
  now: number,
) => {
  const row = round.segments.find(
    (segment) => segment.sequence === segmentIndex,
  );
  const resolved = round.rules.segments[segmentIndex];
  // Admission is bounded on the database clock. Once accepted, provider
  // latency must not revoke the recorded clip when its segment closes.
  const end = row
    ? Math.min(
        Date.parse(row.startedAt) + row.durationMs,
        row.endedAt === null ? Infinity : Date.parse(row.endedAt),
      )
    : 0;
  if (
    !row ||
    !resolved ||
    round.status === 'abandoned' ||
    now < Date.parse(row.startedAt) ||
    now > end + 30_000 ||
    (resolved.type === 'speech' &&
      resolved.side !== personSideOf(round, actorId))
  )
    throw createAppError('CONFLICT', 'That segment is not live');
  return row;
};

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
    } catch (error) {
      if (isAppError(error) && error.code === 'CONFLICT') return false;
      throw error;
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { round, runtime } = await ownedBy(store, actorId, id, () =>
        ids.next(),
      );
      const now = Date.parse(await store.databaseNow());
      const ticked = runtime.tick(new Date(now).toISOString());
      const moved =
        ticked.segmentInserts.length > 0 || ticked.segmentCloses.length > 0;
      if (!moved) return { round, runtime, now, tickedFromVersion: null };
      if (!(await persist(round.id, round.version, null, ticked))) continue;
      const fresh = await store.getRound(id);
      if (!fresh) throw createAppError('NOT_FOUND');
      return {
        round: fresh,
        runtime: runtimeOf(fresh, () => ids.next()),
        now,
        tickedFromVersion:
          fresh.version === round.version + 1 ? round.version : null,
      };
    }
    throw createAppError('CONFLICT', 'The round moved on');
  };

  /** The usage and allowance writes for one billable AI call. */
  const recordUsage: RecordUsage = async (
    roundId,
    participantId,
    actorId,
    usage,
  ) => {
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

  return {
    ...speechOperations(dependencies, hydrated, recordUsage),
    ...crossExaminationOperations(dependencies, hydrated, recordUsage),

    async start(input: {
      readonly actorId: string;
      readonly resolution: string;
      readonly personSide: 'affirmative' | 'negative';
      readonly opponent: string;
    }): Promise<{ readonly id: string }> {
      return startPractice({ store, voice, ids, limits }, input);
    },

    async view({
      actorId,
      id,
    }: {
      readonly actorId: string;
      readonly id: string;
    }): Promise<AiDebateView> {
      const { round, now } = await hydrated(actorId, id);
      return viewOf(dependencies, round, now, actorId);
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
      const { round, runtime, now, tickedFromVersion } = await hydrated(
        actorId,
        id,
      );
      // The caller's version is the optimistic-concurrency claim the handler
      // validated on the way in. Comparing it here is what makes that check
      // mean something: persisting with the freshly hydrated version instead
      // would let a stale browser win every race it lost.
      if (
        round.version !== expectedVersion &&
        tickedFromVersion !== expectedVersion
      )
        throw createAppError('CONFLICT', 'The round moved on');
      const mapped = mappedCommand(command);
      const position = runtime.position(new Date(now).toISOString());
      requireYieldSegment(command, position);
      const acting = actingActorOf(round, actorId, mapped, position);
      const botCommand = acting !== actorId;
      if (botCommand) await requireBotLine(store, round, position, acting);
      const executed = runtime.execute({
        command: mapped,
        actorId: command.type === 'start' ? null : acting,
        now: new Date(now).toISOString(),
      });
      const applied = await persist(
        round.id,
        round.version,
        {
          commandId: ids.next(),
          actorId: command.type === 'start' || botCommand ? null : actorId,
          serviceId:
            command.type === 'start'
              ? 'ai-debate'
              : botCommand
                ? 'ai-opponent'
                : null,
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
      const { round, now } = await hydrated(actorId, id);
      const row = recordedSegmentOf(round, actorId, segmentIndex, now);
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
          requireOpen: false,
        });
      return { text };
    },

    ...judgingOperations(dependencies, hydrated, recordUsage),
  };
}

export type AiDebateOperations = ReturnType<typeof createAiDebateOperations>;
