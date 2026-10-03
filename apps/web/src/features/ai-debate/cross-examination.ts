import { DEFAULT_REASONING, cxMessages, splitSentences } from '@daisy/ai-voice';
import type { AiDebateRecord } from '@daisy/db';
import { turnRoles, type AiDebateTurn } from '@daisy/debate-engine';
import {
  aiSideOf,
  nowMs,
  ownedBy,
  requireLiveTurn,
  stateAt,
  transcriptOf,
  type AiDebateDependencies,
  type AudioFormat,
} from './context';

const CX_REPLY_TOKENS = 180;

export type CrossExamination = {
  /** What the person said, transcribed. */
  readonly heard: string;
  /** The AI's question or answer, if it replies. */
  readonly reply: {
    readonly utteranceId: string;
    readonly sentences: readonly string[];
  } | null;
};

/** One cross-examination exchange at a time. */
export function crossExaminationOperations({
  store,
  voice,
  clock,
  ids,
}: AiDebateDependencies) {
  const transcribeTurn = async (
    record: AiDebateRecord,
    turnIndex: number,
    audio: { readonly base64: string; readonly format: AudioFormat },
  ) => {
    const { text } = await voice().transcribe({
      model: record.sttModel,
      audioBase64: audio.base64,
      format: audio.format,
    });
    await store.recordAiDebateUsage({ aiDebateId: record.id, sttRequests: 1 });
    if (text)
      await store.appendAiDebateUtterance({
        id: ids.next(),
        aiDebateId: record.id,
        turnIndex,
        role: 'person',
        text,
      });
    return text;
  };

  const reply = async (
    record: AiDebateRecord,
    turn: AiDebateTurn,
    aiRole: 'asker' | 'answerer',
    heard: string,
  ): Promise<CrossExamination['reply']> => {
    const messages = cxMessages({
      resolution: record.resolution,
      aiSide: aiSideOf(record),
      turn,
      aiRole,
      transcript: [
        ...transcriptOf(record),
        ...(heard
          ? [{ turnIndex: turn.index, role: 'person' as const, text: heard }]
          : []),
      ],
    });
    const answer = await voice().complete({
      model: record.cxModel,
      messages,
      maxTokens: CX_REPLY_TOKENS,
      temperature: 0.7,
      reasoning: DEFAULT_REASONING.cx,
    });
    await store.recordAiDebateUsage({
      aiDebateId: record.id,
      promptTokens: answer.promptTokens,
      completionTokens: answer.completionTokens,
    });
    const text = answer.text.trim();
    if (!text) return null;
    const utteranceId = ids.next();
    await store.appendAiDebateUtterance({
      id: utteranceId,
      aiDebateId: record.id,
      turnIndex: turn.index,
      role: 'ai',
      text,
    });
    return { utteranceId, sentences: splitSentences(text) };
  };

  return {
    /**
     * The person's utterance (if any) is transcribed, then the AI asks or
     * answers. With the AI asking and nothing said yet, it opens with its
     * first question. Speech arriving in the grace period after the turn
     * is kept but gets no reply.
     */
    async crossExamine({
      actorId,
      id,
      turnIndex,
      audio,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly turnIndex: number;
      readonly audio?: {
        readonly base64: string;
        readonly format: AudioFormat;
      };
    }): Promise<CrossExamination> {
      const record = await ownedBy(store, actorId, id);
      const turn = requireLiveTurn(
        record,
        turnIndex,
        nowMs(clock),
        (_, kind) => kind === 'cross-examination',
      );
      const aiRole =
        turnRoles(turn, record.personSide).asker === 'ai'
          ? 'asker'
          : 'answerer';
      const heard = audio ? await transcribeTurn(record, turnIndex, audio) : '';
      const opening =
        aiRole === 'asker' &&
        !audio &&
        !record.utterances.some((u) => u.turnIndex === turnIndex);
      const now = stateAt(record, nowMs(clock));
      const stillLive = now.phase === 'live' && now.turnIndex === turnIndex;
      if ((!heard && !opening) || !stillLive) return { heard, reply: null };
      return { heard, reply: await reply(record, turn, aiRole, heard) };
    },
  };
}
