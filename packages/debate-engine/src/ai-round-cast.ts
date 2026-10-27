import { debateSides, type RoomAssemblyState } from '@daisy/protocol';

/**
 * A bot debates in this cast, ranked or not: the Round takes one slot of the
 * global bot-debater capacity (ADR 0058). An AI judge is not a bot debater.
 */
export const castSeatsBotDebater = (
  room: Pick<RoomAssemblyState, 'participants'>,
): boolean =>
  room.participants.some(
    (p) =>
      p.kind === 'bot' && (debateSides as readonly string[]).includes(p.role),
  );

/**
 * DEC-186 as amended 2026-10-26: a non-ranked Round spends one host AI-round
 * allowance only when a bot debates. An AI judge is free, so a cast whose only
 * bots judge spends nothing.
 */
export const castSpendsAiRound = (
  room: Pick<RoomAssemblyState, 'competitionType' | 'participants'>,
): boolean => room.competitionType !== 'ranked' && castSeatsBotDebater(room);
