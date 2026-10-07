import { DEFAULT_MODELS, heardText, phrasesOf } from '@daisy/ai-voice';
import type { RoundHydration } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import {
  aiSideOf,
  approximateTokens,
  personSideOf,
  requireOpenSegment,
  transcriptOf,
  type AiDebateDependencies,
  type RoundStore,
} from './context';
import { opponentForActor } from './opponents';
import { writeSpeech, type SpeechEvent } from './speech-writer';

export type { SpeechEvent };

import type { createRoundRuntime } from '@daisy/debate-engine';

type Runtime = ReturnType<typeof createRoundRuntime>;

/** The hydrated round each operation drives, after its time tick. */
type Hydrated = {
  readonly round: RoundHydration;
  readonly runtime: Runtime;
  readonly now: number;
};
type Hydrate = (actorId: string, id: string) => Promise<Hydrated>;
type Usage = (
  roundId: string,
  participantId: string,
  actorId: string,
  usage: {
    readonly kind: 'speech' | 'cross_ex' | 'tts' | 'stt' | 'judging';
    readonly model: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly characters?: number;
    readonly requests?: number;
  },
) => Promise<void>;

const participantRoleOfLine = (round: RoundHydration, participantId: string) =>
  round.participants.find((seat) => seat.id === participantId)?.role ?? 'judge';

/**
 * Characters of voice one debate may buy. The bot speaks about 12,500
 * characters in its longest debate (13 minutes of speeches plus
 * cross-examination); this leaves room for phrases fetched ahead and then
 * cut off, and for rejoining, while capping what a replayed request can
 * cost.
 */
const SPEECH_BUDGET = 30_000;

/** The AI's spoken lines: its speeches, their voice, and what was heard. */
export function speechOperations(
  { store, voice, ids, limits }: AiDebateDependencies,
  hydrated: Hydrate,
  recordUsage: Usage,
) {
  const speechBudget = limits?.speechCharacters ?? SPEECH_BUDGET;

  /**
   * The open segment row for a sequence, waiting out the countdown that
   * opens it: the AI prepares its words while the countdown runs, and the
   * line lands on the row the moment time opens it.
   */
  const waitForSegment = async (
    actorId: string,
    id: string,
    sequence: number,
  ): Promise<{ readonly segmentId: string }> => {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const { round, runtime, now } = await hydrated(actorId, id);
      const open = runtime.position(new Date(now).toISOString()).openSegment;
      const row = round.segments.find(
        (segment) => segment.sequence === sequence,
      );
      if (open !== null && open.sequence >= sequence && row)
        return { segmentId: row.id };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw createAppError('CONFLICT', 'That segment never opened');
  };

  const phrasesOfLine = async (
    actorId: string,
    id: string,
    utteranceId: string,
  ) => {
    const { round } = await hydrated(actorId, id);
    const lines = await store.listRoundUtterances(id);
    const line = lines.find((candidate) => candidate.id === utteranceId);
    if (!line) throw createAppError('NOT_FOUND');
    const segmentIndex = round.segments.findIndex(
      (segment) => segment.id === line.segmentId,
    );
    const personSide = personSideOf(round);
    return {
      round,
      line: {
        id: line.id,
        segmentIndex,
        role:
          participantRoleOfLine(round, line.roundParticipantId) === personSide
            ? ('person' as const)
            : ('ai' as const),
        text: line.text,
        complete: line.complete,
        at: line.createdAt.getTime(),
      },
      phrases: phrasesOf(line.text),
    };
  };

  return {
    /**
     * Writes the AI's speech for one of its speech segments (from the
     * segment's countdown on), phrase by phrase as the model produces it.
     * The model starts in the countdown so its words are ready when the
     * segment opens; nothing is written until the row exists. The speech
     * is saved as it grows, and marked whole only when the model finishes.
     * A later call replays a whole speech and rewrites an unfinished one.
     * `signal` ends the model's stream when the listener goes.
     */
    async *speech({
      actorId,
      id,
      segmentIndex,
      signal,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly segmentIndex: number;
      readonly signal?: AbortSignal;
    }): AsyncGenerator<SpeechEvent> {
      const { round, runtime, now } = await hydrated(actorId, id);
      const position = runtime.position(new Date(now).toISOString());
      const segment = requireOpenSegment(
        position,
        segmentIndex,
        (candidate) =>
          candidate.type === 'speech' && candidate.side !== personSideOf(round),
        { early: true },
      );
      const personSide = personSideOf(round);
      const seatId = round.participants.find(
        (candidate) => candidate.role === aiSideOf(personSide),
      )?.id;
      if (!seatId) throw createAppError('INTERNAL', 'The bot has no seat');
      const lines = await store.listRoundUtterances(id);
      const existing = lines.find((line) => {
        const rowIndex = round.segments.findIndex(
          (candidate) => candidate.id === line.segmentId,
        );
        const role = participantRoleOfLine(round, line.roundParticipantId);
        return rowIndex === segmentIndex && role !== personSide;
      });
      if (existing?.complete) {
        yield { type: 'utterance', id: existing.id };
        for (const [index, text] of phrasesOf(existing.text).entries())
          yield { type: 'phrase', index, text };
        return;
      }
      const utteranceId = existing?.id ?? ids.next();
      if (existing)
        await store.replaceUtterance({
          id: utteranceId,
          roundId: id,
          text: '',
          complete: false,
        });
      yield { type: 'utterance', id: utteranceId };
      yield* writeSpeech({
        store,
        voice,
        round,
        actorId,
        segmentIndex,
        segmentKey: segment.key,
        seatId,
        utteranceId,
        waitForSegment,
        recordUsage,
        signal,
      });
    },

    /**
     * The voice for one phrase of an AI line, as mp3 bytes. Every request
     * spends from the round's speech budget — the seat's recorded TTS
     * characters — before the vendor is called, so asking again and again
     * for a phrase has a ceiling.
     */
    async speak({
      actorId,
      id,
      utteranceId,
      phraseIndex,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly utteranceId: string;
      readonly phraseIndex: number;
    }): Promise<ArrayBuffer> {
      const { round } = await hydrated(actorId, id);
      const { phrases } = await phrasesOfLine(actorId, id, utteranceId);
      const text = phrases[phraseIndex];
      if (!text) throw createAppError('NOT_FOUND');
      const speaker = voice();
      const personSide = personSideOf(round);
      const seatId = round.participants.find(
        (candidate) => candidate.role === aiSideOf(personSide),
      )?.id;
      if (!seatId) throw createAppError('INTERNAL', 'The bot has no seat');
      const spent = await store.spokenCharactersFor({
        roundParticipantId: seatId,
      });
      if (spent + text.length > speechBudget)
        throw createAppError('RATE_LIMIT', 'Speech budget spent');
      const bot = opponentForActor(
        round.participants.find(
          (candidate) => candidate.role === aiSideOf(personSide),
        )?.actorId,
      );
      const { audio } = await speaker.speak({
        model: DEFAULT_MODELS.tts,
        voice: bot?.voice ?? 'aura-2-thalia-en',
        text,
      });
      await recordUsage(id, seatId, actorId, {
        kind: 'tts',
        model: DEFAULT_MODELS.tts,
        characters: text.length,
      });
      return audio;
    },

    /**
     * Keeps only what the person heard of an AI line cut short (a barge-in
     * or the end of the segment): whole phrases before the one playing, and
     * the played share of that one.
     */
    async heard({
      actorId,
      id,
      utteranceId,
      phraseIndex,
      playedMs,
      totalMs,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly utteranceId: string;
      readonly phraseIndex: number;
      readonly playedMs: number;
      readonly totalMs: number;
    }): Promise<void> {
      const { phrases } = await phrasesOfLine(actorId, id, utteranceId);
      if (phraseIndex >= phrases.length) return;
      const kept = [
        ...phrases.slice(0, phraseIndex),
        heardText(phrases[phraseIndex]!, playedMs, totalMs),
      ]
        .filter(Boolean)
        .join(' ');
      await store.replaceUtterance({
        id: utteranceId,
        roundId: id,
        text: kept,
      });
    },
  };
}
