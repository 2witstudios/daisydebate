import { DEFAULT_MODELS, heardText, phrasesOf } from '@daisy/ai-voice';
import type { RoundHydration } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import {
  aiSideOf,
  personSideOf,
  requireOpenSegment,
  type AiDebateDependencies,
  type RecordUsage,
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
const participantRoleOfLine = (round: RoundHydration, participantId: string) =>
  round.participants.find((seat) => seat.id === participantId)?.role ?? 'judge';

/** The bot's seat: the AI side's only participant; throws when unseated. */
const botSeatOf = (round: RoundHydration, actorId: string) => {
  const seat = round.participants.find(
    (candidate) => candidate.role === aiSideOf(personSideOf(round, actorId)),
  );
  if (!seat) throw createAppError('INTERNAL', 'The bot has no seat');
  return seat;
};

/**
 * Characters of voice one debate may buy. The bot speaks about 12,500
 * characters in its longest debate (13 minutes of speeches plus
 * cross-examination); this leaves room for phrases fetched ahead and then
 * cut off, and for rejoining, while capping what a replayed request can
 * cost.
 */
const SPEECH_BUDGET = 30_000;

const segmentClosed = (
  status: string,
  openSequence: number | null,
  expected: number,
  endedAt: string | null | undefined,
): boolean =>
  status === 'completed' ||
  status === 'abandoned' ||
  (openSequence !== null && openSequence > expected) ||
  (endedAt !== null && endedAt !== undefined);

/** The AI's spoken lines: its speeches, their voice, and what was heard. */
export function speechOperations(
  { store, voice, ids, limits }: AiDebateDependencies,
  hydrated: Hydrate,
  recordUsage: RecordUsage,
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
      if (open?.sequence === sequence && row?.endedAt === null)
        return { segmentId: row.id };
      if (
        segmentClosed(
          round.status,
          open?.sequence ?? null,
          sequence,
          row?.endedAt,
        )
      )
        throw createAppError('CONFLICT', 'That segment is closed');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw createAppError('CONFLICT', 'That segment never opened');
  };

  /**
   * The phrases of one of the **bot's** lines.
   *
   * Both callers are about the AI's voice: `speak` fetches a phrase as mp3 and
   * `heard` rewrites the line down to what the listener actually heard. This
   * used to accept any utterance the round held, which let a client point
   * either at the person's own transcript — spending the bot's character budget
   * to speak the member's words back at them, and rewriting the member's
   * record of what they said. So the line's seat has to be the bot's.
   *
   * A person's utterance is refused as `NOT_FOUND`, not as a permission error:
   * from the caller's side these ids name lines that are not speakable, and
   * saying so plainly would confirm the id exists.
   */
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
    const personSide = personSideOf(round, actorId);
    const role =
      participantRoleOfLine(round, line.roundParticipantId) === personSide
        ? ('person' as const)
        : ('ai' as const);
    if (role !== 'ai') throw createAppError('NOT_FOUND');
    return {
      round,
      line: {
        id: line.id,
        segmentIndex,
        role,
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
     * segment's live window), phrase by phrase as the model produces it.
     * The segment row carries a durable generation claim before the model
     * starts. The speech is saved as it grows and marked whole when the
     * model finishes. A later call replays a whole speech; an unfinished
     * line can be rewritten only after its claim expires.
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
          candidate.type === 'speech' &&
          candidate.side !== personSideOf(round, actorId),
        { early: true },
      );
      const seatId = botSeatOf(round, actorId).id;
      const opened = await waitForSegment(actorId, id, segmentIndex);
      const token = ids.next();
      const claim = await store.claimSpeech({
        id: ids.next(),
        roundId: id,
        segmentId: opened.segmentId,
        roundParticipantId: seatId,
        token,
      });
      if (claim.status === 'held')
        throw createAppError('CONFLICT', 'Speech generation in progress');
      if (claim.status === 'complete') {
        const existing = (await store.listRoundUtterances(id)).find(
          (line) => line.id === claim.utteranceId,
        );
        if (!existing) throw createAppError('INVARIANT', 'Speech line missing');
        yield { type: 'utterance', id: existing.id };
        for (const [index, text] of phrasesOf(existing.text).entries())
          yield { type: 'phrase', index, text };
        return;
      }
      const utteranceId = claim.utteranceId;
      try {
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
          speechToken: token,
          recordUsage,
          signal,
        });
      } finally {
        await store.releaseSpeech({ utteranceId, roundId: id, token });
      }
    },

    /**
     * The voice for one phrase of an AI line, as mp3 bytes. Every request
     * claims from the round's speech budget — the seat's recorded TTS
     * characters — before the vendor is called, so asking again and again
     * for a phrase has a ceiling.
     *
     * The claim is `reserveSpokenCharacters`, not a read of the total: reading
     * the spent total and then calling the vendor was check-then-act, so two
     * requests arriving together both passed the same check and both called
     * the vendor, and the budget capped nothing. The claim serialises on the
     * seat, and the vendor is only called once it is held.
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
      const { id: seatId, actorId: botActorId } = botSeatOf(round, actorId);
      const bot = opponentForActor(botActorId);
      const claimed = await store.reserveSpokenCharacters({
        id: ids.next(),
        roundParticipantId: seatId,
        characters: text.length,
        budget: speechBudget,
        model: DEFAULT_MODELS.tts,
        provider: 'openrouter',
      });
      if (!claimed) throw createAppError('RATE_LIMIT', 'Speech budget spent');
      // The claim is itself billable usage, so the reservation is counted from
      // this point on exactly as it would have been by the old `recordUsage`.
      await store.markReservationCounted({ actorId, roundId: id });
      const { audio } = await speaker.speak({
        model: DEFAULT_MODELS.tts,
        voice: bot?.voice ?? 'aura-2-thalia-en',
        text,
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
        requireOpen: false,
      });
    },
  };
}
