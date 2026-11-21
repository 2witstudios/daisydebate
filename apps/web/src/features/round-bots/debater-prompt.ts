import { instantMs } from '@daisy/clock';
import { roundDebaterMessages, roundSpeakerMessages } from '@daisy/ai-voice';
import type {
  createBotPublicationOperations,
  BotPublicationScope,
} from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import {
  leadSeatOf,
  sameSeat,
  seatLabel,
  seatsOfKind,
  segmentDueAtMs,
  sideOfSeat,
} from '@daisy/protocol';
import type { Owed } from './duty';

type Context = Awaited<
  ReturnType<
    ReturnType<typeof createBotPublicationOperations>['beginGeneration']
  >
>;
type Segment = Context['round']['segments'][number];
type Rule = Context['round']['rules']['segments'][number];
const dueAtOf = (segment: Segment) =>
  segmentDueAtMs({
    startedAtMs: instantMs(segment.startedAt),
    durationMs: segment.durationMs,
    returnedMs: segment.returnedMs,
  });
/**
 * The prompt for one turn of a claim: the seat, its persona, the segment and
 * the time left in it, and the transcript as spoken so far. Refuses a claim
 * with nothing left to say it in.
 */
export function debaterPrompt(
  context: Context,
  scope: BotPublicationScope,
  nowMs: number,
  to: Owed,
) {
  const { round, seat } = context;
  const segment = round.segments.find((row) => row.id === scope.segmentId);
  const rule = round.rules.segments.find(
    (row) => row.key === segment?.rulesSegmentKey,
  );
  if (
    !segment ||
    !rule ||
    segment.type === 'open' ||
    !Number.isFinite(nowMs) ||
    round.resolution === null
  )
    throw createAppError('CONFLICT');
  const turn: Turn = {
    segment: { ...segment, type: segment.type },
    rule,
    resolution: round.resolution,
    nowMs,
  };
  switch (seat.seat.kind) {
    case 'side':
      return sidePrompt(context, turn, to);
    case 'speaker':
      return speakerPrompt(context, turn);
    case 'judge':
    case 'moderator':
      throw createAppError('CONFLICT');
  }
}

type Turn = {
  readonly segment: Segment & { readonly type: 'speech' | 'cross_ex' };
  readonly rule: Rule;
  readonly resolution: string;
  readonly nowMs: number;
};

const remainingMs = (turn: Turn) => {
  const durationMs = dueAtOf(turn.segment) - turn.nowMs;
  if (durationMs <= 0) throw createAppError('CONFLICT');
  return durationMs;
};

/** A side's debater, in a speech or a cross-examination a side leads. */
function sidePrompt(context: Context, turn: Turn, to: Owed) {
  const { round, seat, profile } = context;
  const { segment, rule } = turn;
  const lead = leadSeatOf(rule.speak);
  const ruleSide = lead && sideOfSeat(lead);
  if (seat.seat.kind !== 'side' || ruleSide === null)
    throw createAppError('CONFLICT');
  const durationMs = remainingMs(turn);
  return roundDebaterMessages({
    resolution: turn.resolution,
    side: seat.seat.side,
    slot: seat.seat.slot,
    persona: `${profile.name}. ${profile.persona} Debate difficulty: ${profile.difficulty}.`,
    segment: {
      name: rule.key,
      label: rule.label,
      type: segment.type,
      side: ruleSide,
      durationMs,
    },
    unanswered: to.kind === 'unanswered',
    transcript: context.utterances.flatMap((line) => {
      const speaker = round.participants.find(
        (row) => row.id === line.roundParticipantId,
      );
      const spoken = round.segments.find((row) => row.id === line.segmentId);
      return speaker && speaker.seat.kind === 'side' && spoken
        ? [
            {
              side: speaker.seat.side,
              slot: speaker.seat.slot,
              segment: spoken.rulesSegmentKey,
              text: line.text,
              complete: line.complete,
              interrupted: line.interrupted,
            },
          ]
        : [];
    }),
  });
}

/**
 * An unsided speaker (TAB-6.18), in its own speech: one of the section's
 * speakers on the resolution, with no opponent side.
 */
function speakerPrompt(context: Context, turn: Turn) {
  const { round, seat, profile } = context;
  const { segment, rule } = turn;
  // A speaker speaks only its own speech: a section has no cross-examination.
  const lead = leadSeatOf(rule.speak);
  if (
    seat.seat.kind !== 'speaker' ||
    segment.type !== 'speech' ||
    lead === null ||
    !sameSeat(lead, seat.seat)
  )
    throw createAppError('CONFLICT');
  const durationMs = remainingMs(turn);
  const speakers = seatsOfKind(round.rules, 'speaker');
  const labelOf = (of: typeof seat.seat) =>
    seatLabel(round.rules.sides, of, speakers);
  return roundSpeakerMessages({
    resolution: turn.resolution,
    seatLabel: labelOf(seat.seat),
    speakers,
    persona: `${profile.name}. ${profile.persona} Debate difficulty: ${profile.difficulty}.`,
    segment: { name: rule.key, label: rule.label, durationMs },
    transcript: context.utterances.flatMap((line) => {
      const speaker = round.participants.find(
        (row) => row.id === line.roundParticipantId,
      );
      const spoken = round.segments.find((row) => row.id === line.segmentId);
      return speaker && speaker.seat.kind === 'speaker' && spoken
        ? [
            {
              seatLabel: labelOf(speaker.seat),
              segment: spoken.rulesSegmentKey,
              text: line.text,
              complete: line.complete,
              interrupted: line.interrupted,
            },
          ]
        : [];
    }),
  });
}
