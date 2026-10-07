import { DEFAULT_MODELS } from '@daisy/ai-voice';
import type { RoundCommand, RoundProjection } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { RoundStore } from './context';
import {
  digestOf,
  ownedBy,
  participantIdOf,
  personSideOf,
  runtimeOf,
  type AiDebateDependencies,
  type AiDebateView,
  type AudioFormat,
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
  | { readonly type: 'yield' }
  | { readonly type: 'abort' };


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
      const { round, runtime, now } = await hydrated(actorId, id);
      // The caller's version is the optimistic-concurrency claim the handler
      // validated on the way in. Comparing it here is what makes that check
      // mean something: persisting with the freshly hydrated version instead
      // would let a stale browser win every race it lost.
      if (round.version !== expectedVersion)
        throw createAppError('CONFLICT', 'The round moved on');
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
        (open.type === 'speech' && open.side !== personSideOf(round, actorId))
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

    ...judgingOperations(dependencies, hydrated, recordUsage),
  };
}

export type AiDebateOperations = ReturnType<typeof createAiDebateOperations>;
