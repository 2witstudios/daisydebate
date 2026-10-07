import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  createPhraseBuffer,
  createSentenceBuffer,
  phrasesOf,
  speechMessages,
} from '@daisy/ai-voice';
import type { RoundHydration } from '@daisy/db';
import type { createRoundRuntime } from '@daisy/debate-engine';
import type { RoundStore } from './context';
import {
  aiSideOf,
  approximateTokens,
  personSideOf,
  transcriptOf,
  type AiDebateDependencies,
} from './context';
import { opponentForActor } from './opponents';

type Runtime = ReturnType<typeof createRoundRuntime>;

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

export type SpeechEvent =
  | { readonly type: 'utterance'; readonly id: string }
  | {
      readonly type: 'phrase';
      readonly index: number;
      readonly text: string;
    };

const participantRoleOfLine = (round: RoundHydration, participantId: string) =>
  round.participants.find((seat) => seat.id === participantId)?.role ?? 'judge';

/** Streams the model's speech into its line, phrase by phrase. */
export async function* writeSpeech({
  store,
  voice,
  round,
  actorId,
  segmentIndex,
  segmentKey,
  seatId,
  utteranceId,
  waitForSegment,
  recordUsage,
  signal,
}: {
  readonly store: RoundStore;
  readonly voice: AiDebateDependencies['voice'];
  readonly round: RoundHydration;
  readonly actorId: string;
  readonly segmentIndex: number;
  readonly segmentKey: string;
  readonly seatId: string;
  readonly utteranceId: string;
  readonly waitForSegment: (
    actorId: string,
    id: string,
    sequence: number,
  ) => Promise<{ readonly segmentId: string }>;
  readonly recordUsage: Usage;
  readonly signal: AbortSignal | undefined;
}): AsyncGenerator<SpeechEvent> {
  const personSide = personSideOf(round);
  const segment = round.rules.segments[segmentIndex]!;
  const lines = await store.listRoundUtterances(round.id);
  const messages = speechMessages({
    resolution: round.resolution,
    aiSide: aiSideOf(personSide),
    turn: {
      index: segmentIndex,
      name: segment.key,
      label: segment.label,
      kind:
        segment.type === 'speech'
          ? ('speech' as const)
          : ('cross-examination' as const),
      side: segment.side,
      durationMs: segment.durationMs,
    },
    transcript: transcriptOf(
      round.rules,
      lines.map((line) => ({
        id: line.id,
        segmentIndex: round.segments.findIndex(
          (candidate) => candidate.id === line.segmentId,
        ),
        role:
          participantRoleOfLine(round, line.roundParticipantId) === personSide
            ? ('person' as const)
            : ('ai' as const),
        text: line.text,
        complete: line.complete,
        at: line.createdAt.getTime(),
      })),
    ),
    persona: opponentForActor(
      round.participants.find(
        (candidate) => candidate.role === aiSideOf(personSide),
      )?.actorId,
    )?.persona,
  });
  const sentences = createSentenceBuffer();
  const phrases = createPhraseBuffer();
  const grouped = (done: readonly string[]) =>
    done.flatMap((sentence) => phrases.push(sentence));
  const spoken: string[] = [];
  let landed = false;
  const save = async function* (incoming: readonly string[], whole = false) {
    for (const text of incoming) {
      spoken.push(text);
      if (!landed) {
        // The line lands only when time has opened the segment's row.
        const opened = await waitForSegment(actorId, round.id, segmentIndex);
        await store.appendUtterance({
          id: utteranceId,
          roundId: round.id,
          segmentId: opened.segmentId,
          roundParticipantId: seatId,
          text: spoken.join(' '),
          complete: false,
        });
        landed = true;
        yield { type: 'phrase' as const, index: spoken.length - 1, text };
        continue;
      }
      await store.replaceUtterance({
        id: utteranceId,
        roundId: round.id,
        text: spoken.join(' '),
        ...(whole ? { complete: true } : {}),
      });
      yield { type: 'phrase' as const, index: spoken.length - 1, text };
    }
    if (whole && landed)
      await store.replaceUtterance({
        id: utteranceId,
        roundId: round.id,
        text: spoken.join(' '),
        complete: true,
      });
  };
  let written = 0;
  for await (const delta of voice().stream({
    model: DEFAULT_MODELS.speech,
    messages,
    maxTokens: 4_000,
    temperature: 0.8,
    reasoning: DEFAULT_REASONING.speech,
    ...(signal ? { signal } : {}),
  })) {
    written += delta.length;
    yield* save(grouped(sentences.push(delta)));
  }
  yield* save([...grouped(sentences.flush()), ...phrases.flush()], true);
  await recordUsage(round.id, seatId, actorId, {
    kind: 'speech',
    model: DEFAULT_MODELS.speech,
    inputTokens: approximateTokens(
      messages.reduce((sum, message) => sum + message.content.length, 0),
    ),
    outputTokens: approximateTokens(written),
  });
  void segmentKey;
}
