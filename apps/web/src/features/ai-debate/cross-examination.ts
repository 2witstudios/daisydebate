import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  cxMessages,
  phrasesOf,
} from '@daisy/ai-voice';
import type { RoundHydration } from '@daisy/db';
import type { createRoundRuntime } from '@daisy/debate-engine';
import type { AiDebateDependencies, AudioFormat } from './context';
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

type UsageRecorder = (
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
  aiAsks: boolean,
  hasAudio: boolean,
  saidInExchange: number,
  heard: string,
): boolean => {
  const opening = aiAsks && !hasAudio && saidInExchange === 0;
  return (
    (heard.length > 0 || opening) &&
    (stage === 'live' || (opening && stage === 'countdown'))
  );
};

/** One cross-examination exchange at a time. */
export function crossExaminationOperations(
  { store, voice, ids }: AiDebateDependencies,
  hydrated: Hydrated,
  recordUsage: UsageRecorder,
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
        requireOpen: false,
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
    heard: string,
    lines: Awaited<ReturnType<RoundStore['listRoundUtterances']>>,
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
      transcript: [
        ...transcriptOf(
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
        ...(heard
          ? [{ turn: segment.key, role: 'person' as const, text: heard }]
          : []),
      ],
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
    await store.appendUtterance({
      id: utteranceId,
      roundId: id,
      segmentId: segment.id,
      roundParticipantId: aiSeatId,
      text,
      requireOpen: true,
    });
    return { utteranceId, phrases: phrasesOf(text) };
  };

  return {
    /**
     * The person's utterance (if any) is transcribed, then the AI asks or
     * answers. With the AI asking and nothing said yet, it opens with its
     * first question, which it may prepare during the countdown. Speech
     * arriving in the grace period after the segment is kept but gets no
     * reply.
     */
    async crossExamine({
      actorId,
      id,
      segmentIndex,
      audio,
    }: ExchangeInput): Promise<CrossExamination> {
      // The opening ask is prepared during the countdown, so it can arrive
      // before the segment's row exists: the durable row opens at the
      // database's instant, and the browser's ask runs on its own clock.
      // Re-read until the row is there or the wait is spent — the clock
      // stays PostgreSQL's; the wait only bounds how long the ask lingers,
      // and it spans the countdown the ask may have jumped into.
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
      // "Nothing has been said **in this exchange**", counted on this
      // segment's rows only. The round's whole transcript is never empty once
      // the constructive has been spoken, so counting all of it made this
      // false exactly when the AI was supposed to open — the AI could ask its
      // first question only if the debate began with cross-examination, and
      // after the constructive it sat silent while its own segment ran.
      const saidInExchange = lines.filter(
        (line) => line.segmentId === segment.id,
      ).length;
      // The AI replies while its segment is live, or in the countdown when
      // it opens the exchange; a grace-period line gets no reply.
      if (
        !shouldReply(
          position.stage,
          aiAsks,
          audio !== undefined,
          saidInExchange,
          heard,
        )
      )
        return { heard, reply: null };
      const reply = await replyOf(
        round,
        segment,
        seats.aiSeat,
        actorId,
        id,
        aiAsks ? 'asker' : 'answerer',
        personSide,
        heard,
        lines,
      );
      return { heard, reply };
    },
  };
}

/** The store contract `replyOf` reads through. */
type RoundStore = AiDebateDependencies['store'];
