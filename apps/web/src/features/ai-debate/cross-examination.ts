import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  cxMessages,
  phrasesOf,
} from '@daisy/ai-voice';
import type { RoundHydration } from '@daisy/db';
import type { createRoundRuntime } from '@daisy/debate-engine';
import type { AiDebateDependencies, AudioFormat, RecordUsage } from './context';
import {
  aiSideOf,
  participantIdOf,
  personSideOf,
  requireOpenSegment,
  transcriptOf,
} from './context';
import { opponentForActor } from './opponents';

const CX_REPLY_TOKENS = 180;

type Hydrated = (
  actorId: string,
  id: string,
) => Promise<{
  readonly round: RoundHydration;
  readonly runtime: ReturnType<typeof createRoundRuntime>;
  readonly now: number;
}>;

export type CrossExamination = {
  /** What the person said, transcribed. */
  readonly heard: string;
  /** The AI's question or answer, if it replies. */
  readonly reply: {
    readonly utteranceId: string;
    readonly phrases: readonly string[];
  } | null;
};

type ExchangeInput = {
  readonly actorId: string;
  readonly id: string;
  readonly segmentIndex: number;
  readonly audio?: {
    readonly base64: string;
    readonly format: AudioFormat;
  };
};

const shouldReply = (
  stage: 'live' | 'countdown' | 'prep' | null,
  heard: string,
  opening: boolean,
) =>
  (heard.length > 0 || opening) &&
  (stage === 'live' || (opening && stage === 'countdown'));

/** One cross-examination exchange at a time. */
export function crossExaminationOperations(
  { store, voice, ids }: AiDebateDependencies,
  hydrated: Hydrated,
  recordUsage: RecordUsage,
) {
  const seatIdsOf = (
    round: RoundHydration,
    personSide: 'affirmative' | 'negative',
  ) => {
    const personSeat = round.participants.find(
      (seat) => seat.role === personSide,
    );
    const aiSeat = round.participants.find(
      (seat) => seat.role === aiSideOf(personSide),
    );
    if (!personSeat || !aiSeat)
      throw new Error('The round is missing a debater seat');
    return { personSeat: personSeat.id, aiSeat: aiSeat.id };
  };

  /** Transcribes one chunk of the person's speech and records it. */
  const transcribeHeard = async (
    round: RoundHydration,
    segmentId: string,
    personSeatId: string,
    actorId: string,
    id: string,
    audio: { readonly base64: string; readonly format: AudioFormat },
  ): Promise<string> => {
    const { text } = await voice().transcribe({
      model: DEFAULT_MODELS.stt,
      audioBase64: audio.base64,
      format: audio.format,
    });
    await recordUsage(id, participantIdOf(round, actorId), actorId, {
      kind: 'stt',
      model: DEFAULT_MODELS.stt,
      requests: 1,
    });
    if (text)
      await store.appendUtterance({
        id: ids.next(),
        roundId: id,
        segmentId,
        roundParticipantId: personSeatId,
        text,
        requireOpen: true,
      });
    return text;
  };

  /** The open cross-examination segment a request is about. */
  const openSegmentOf = (
    round: RoundHydration,
    runtime: ReturnType<typeof createRoundRuntime>,
    now: number,
    segmentIndex: number,
    withAudio: boolean,
  ) => {
    const position = runtime.position(new Date(now).toISOString());
    const segment = requireOpenSegment(
      position,
      segmentIndex,
      (candidate) => candidate.type === 'cross_ex',
      { early: !withAudio },
    );
    const row = round.segments.find(
      (candidate) => candidate.sequence === segment.sequence,
    );
    // The grace window: the position already shows the segment (early), but
    // its durable row opens at the database's instant and may lag one ask.
    if (!row) return null;
    return { position, segment: { ...segment, id: row.id } };
  };

  /** The AI's question or answer, spoken as its own line. */
  const replyOf = async (
    round: RoundHydration,
    segment: {
      readonly key: string;
      readonly label: string;
      readonly sequence: number;
      readonly side: 'affirmative' | 'negative';
      readonly id: string;
    },
    aiSeatId: string,
    actorId: string,
    id: string,
    aiRole: 'asker' | 'answerer',
    personSide: 'affirmative' | 'negative',
    lines: Awaited<ReturnType<RoundStore['listRoundUtterances']>>,
    opening: boolean,
  ): Promise<CrossExamination['reply']> => {
    const turn = {
      index: segment.sequence,
      name: segment.key,
      label: segment.label,
      kind: 'cross-examination' as const,
      side: segment.side,
      durationMs: round.rules.segments[segment.sequence]?.durationMs ?? 0,
    };
    const roleOfLine = (roundParticipantId: string) =>
      (round.participants.find((seat) => seat.id === roundParticipantId)
        ?.role ?? 'judge') === personSide
        ? ('person' as const)
        : ('ai' as const);
    const messages = cxMessages({
      resolution: round.resolution,
      aiSide: aiSideOf(personSide),
      turn,
      aiRole,
      transcript: transcriptOf(
        round.rules,
        lines.map((line) => ({
          id: line.id,
          segmentIndex: round.segments.findIndex(
            (candidate) => candidate.id === line.segmentId,
          ),
          role: roleOfLine(line.roundParticipantId),
          text: line.text,
          complete: line.complete,
          at: line.createdAt.getTime(),
        })),
      ),
      persona: opponentForActor(
        round.participants.find((seat) => seat.role === aiSideOf(personSide))
          ?.actorId,
      )?.persona,
    });
    const answer = await voice().complete({
      model: DEFAULT_MODELS.cx,
      messages,
      maxTokens: CX_REPLY_TOKENS,
      temperature: 0.7,
      reasoning: DEFAULT_REASONING.cx,
    });
    await recordUsage(id, aiSeatId, actorId, {
      kind: 'cross_ex',
      model: DEFAULT_MODELS.cx,
      inputTokens: answer.promptTokens,
      outputTokens: answer.completionTokens,
    });
    const text = answer.text.trim();
    if (!text) return null;
    const utteranceId = ids.next();
    const stored = await store.appendUtterance({
      id: utteranceId,
      roundId: id,
      segmentId: segment.id,
      roundParticipantId: aiSeatId,
      text,
      requireOpen: true,
      requireEmptySegment: opening,
    });
    if (!stored) return null;
    return { utteranceId, phrases: phrasesOf(text) };
  };

  return {
    /**
     * The person's utterance (if any) is transcribed, then the AI asks or
     * answers. With the AI asking and nothing said yet, it opens with its
     * first question, which it may prepare during the countdown. Speech
     * arriving after the segment closes is refused at the database write.
     */
    async crossExamine({
      actorId,
      id,
      segmentIndex,
      audio,
    }: ExchangeInput): Promise<CrossExamination> {
      // Bound the wait for PostgreSQL to open the segment after countdown.
      for (let attempt = 0; ; attempt += 1) {
        const outcome = await this.exchange({
          actorId,
          id,
          segmentIndex,
          ...(audio ? { audio } : {}),
        });
        if (outcome !== null || attempt >= 12)
          return outcome ?? { heard: '', reply: null };
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    },

    async exchange({
      actorId,
      id,
      segmentIndex,
      audio,
    }: ExchangeInput): Promise<CrossExamination | null> {
      const { round, runtime, now } = await hydrated(actorId, id);
      const personSide = personSideOf(round, actorId);
      const opened = openSegmentOf(
        round,
        runtime,
        now,
        segmentIndex,
        audio !== undefined,
      );
      if (opened === null) return null;
      const { position, segment } = opened;
      const aiAsks = segment.side !== personSide;
      const seats = seatIdsOf(round, personSide);

      const heard = audio
        ? await transcribeHeard(
            round,
            segment.id,
            seats.personSeat,
            actorId,
            id,
            audio,
          )
        : '';

      const lines = await store.listRoundUtterances(id);
      // Count only this segment's lines when deciding whether to open CX.
      const saidInExchange = lines.filter(
        (line) => line.segmentId === segment.id,
      ).length;
      const opening = aiAsks && audio === undefined && saidInExchange === 0;
      if (!shouldReply(position.stage, heard, opening))
        return { heard, reply: null };
      const reply = await replyOf(
        round,
        segment,
        seats.aiSeat,
        actorId,
        id,
        aiAsks ? 'asker' : 'answerer',
        personSide,
        lines,
        opening,
      );
      return { heard, reply };
    },
  };
}

/** The store contract `replyOf` reads through. */
type RoundStore = AiDebateDependencies['store'];
