import { roundDebaterMessages } from '@daisy/ai-voice';
import type {
  createBotPublicationOperations,
  BotPublicationScope,
} from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import { leadSeatOf, segmentDueAtMs, sideOfSeat } from '@daisy/protocol';
import type { Owed } from './duty';

type Context = Awaited<
  ReturnType<
    ReturnType<typeof createBotPublicationOperations>['beginGeneration']
  >
>;
const dueAtOf = (segment: Context['round']['segments'][number]) =>
  segmentDueAtMs({
    startedAtMs: Date.parse(segment.startedAt),
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
  const { round, seat, profile } = context;
  const segment = round.segments.find((row) => row.id === scope.segmentId);
  const rule = round.rules.segments.find(
    (row) => row.key === segment?.rulesSegmentKey,
  );
  // A bot debates for a side, in a speech or a cross-examination a side leads.
  const lead = rule ? leadSeatOf(rule.speak) : null;
  const ruleSide = lead && sideOfSeat(lead);
  if (
    !segment ||
    !rule ||
    seat.seat.kind !== 'side' ||
    ruleSide === null ||
    segment.type === 'open' ||
    !Number.isFinite(nowMs) ||
    round.resolution === null
  )
    throw createAppError('CONFLICT');
  const durationMs = dueAtOf(segment) - nowMs;
  if (durationMs <= 0) throw createAppError('CONFLICT');
  return roundDebaterMessages({
    resolution: round.resolution,
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
