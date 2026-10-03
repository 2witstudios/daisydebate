import {
  DEFAULT_REASONING,
  createSentenceBuffer,
  heardText,
  speechMessages,
  splitSentences,
} from '@daisy/ai-voice';
import { createAppError } from '@daisy/errors';
import {
  aiSideOf,
  approximateTokens,
  nowMs,
  ownedBy,
  requireLiveTurn,
  transcriptOf,
  type AiDebateDependencies,
} from './context';

export type SpeechEvent =
  | { readonly type: 'utterance'; readonly id: string }
  | {
      readonly type: 'sentence';
      readonly index: number;
      readonly text: string;
    };

/** The AI's spoken lines: its speeches, their voice, and what was heard. */
export function speechOperations({
  store,
  voice,
  clock,
  ids,
}: AiDebateDependencies) {
  const sentencesOf = async (
    actorId: string,
    id: string,
    utteranceId: string,
  ) => {
    const record = await ownedBy(store, actorId, id);
    const utterance = record.utterances.find(
      (u) => u.id === utteranceId && u.role === 'ai',
    );
    if (!utterance) throw createAppError('NOT_FOUND');
    return { record, sentences: splitSentences(utterance.text) };
  };

  return {
    /**
     * Writes the AI's speech for a live AI speech turn, sentence by
     * sentence as the model produces it. The speech is saved as it grows,
     * so the voice can be fetched per sentence and a reload resumes it. A
     * second call for the same turn replays the saved speech.
     */
    async *speech({
      actorId,
      id,
      turnIndex,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly turnIndex: number;
    }): AsyncGenerator<SpeechEvent> {
      const record = await ownedBy(store, actorId, id);
      const turn = requireLiveTurn(
        record,
        turnIndex,
        nowMs(clock),
        (roles, kind) => kind === 'speech' && roles.speaker === 'ai',
      );
      const existing = record.utterances.find(
        (u) => u.turnIndex === turnIndex && u.role === 'ai',
      );
      if (existing) {
        yield { type: 'utterance', id: existing.id };
        for (const [index, text] of splitSentences(existing.text).entries())
          yield { type: 'sentence', index, text };
        return;
      }
      const utteranceId = ids.next();
      await store.appendAiDebateUtterance({
        id: utteranceId,
        aiDebateId: id,
        turnIndex,
        role: 'ai',
        text: '',
      });
      yield { type: 'utterance', id: utteranceId };
      const messages = speechMessages({
        resolution: record.resolution,
        aiSide: aiSideOf(record),
        turn,
        transcript: transcriptOf(record),
      });
      const buffer = createSentenceBuffer();
      const spoken: string[] = [];
      let written = 0;
      const save = async function* (sentences: readonly string[]) {
        for (const text of sentences) {
          spoken.push(text);
          await store.replaceAiDebateUtterance({
            id: utteranceId,
            aiDebateId: id,
            text: spoken.join(' '),
          });
          yield { type: 'sentence' as const, index: spoken.length - 1, text };
        }
      };
      for await (const delta of voice().stream({
        model: record.speechModel,
        messages,
        maxTokens: 4_000,
        temperature: 0.8,
        reasoning: DEFAULT_REASONING.speech,
      })) {
        written += delta.length;
        yield* save(buffer.push(delta));
      }
      yield* save(buffer.flush());
      await store.recordAiDebateUsage({
        aiDebateId: id,
        promptTokens: approximateTokens(
          messages.reduce((sum, message) => sum + message.content.length, 0),
        ),
        completionTokens: approximateTokens(written),
      });
    },

    /** The voice for one sentence of an AI line, as mp3 bytes. */
    async speak({
      actorId,
      id,
      utteranceId,
      sentenceIndex,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly utteranceId: string;
      readonly sentenceIndex: number;
    }): Promise<ArrayBuffer> {
      const { record, sentences } = await sentencesOf(actorId, id, utteranceId);
      const text = sentences[sentenceIndex];
      if (!text) throw createAppError('NOT_FOUND');
      const { audio, characters } = await voice().speak({
        model: record.ttsModel,
        voice: record.voice,
        text,
      });
      await store.recordAiDebateUsage({
        aiDebateId: id,
        ttsCharacters: characters,
      });
      return audio;
    },

    /**
     * Keeps only what the person heard of an AI line cut short (a barge-in
     * or the end of the turn): whole sentences before the one playing, and
     * the played share of that one.
     */
    async heard({
      actorId,
      id,
      utteranceId,
      sentenceIndex,
      playedMs,
      totalMs,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly utteranceId: string;
      readonly sentenceIndex: number;
      readonly playedMs: number;
      readonly totalMs: number;
    }): Promise<void> {
      const { sentences } = await sentencesOf(actorId, id, utteranceId);
      if (sentenceIndex >= sentences.length) return;
      const kept = [
        ...sentences.slice(0, sentenceIndex),
        heardText(sentences[sentenceIndex]!, playedMs, totalMs),
      ]
        .filter(Boolean)
        .join(' ');
      await store.replaceAiDebateUtterance({
        id: utteranceId,
        aiDebateId: id,
        text: kept,
      });
    },
  };
}
