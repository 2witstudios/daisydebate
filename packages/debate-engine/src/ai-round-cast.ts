import { debateSides, type RoomAssemblyState } from '@daisy/protocol';

/**
 * A bot debates in this cast, which is the one fact Launch acts on: the host
 * spends an AI-round allowance (DEC-186 as amended 2026-10-26) and the Round
 * takes a slot of the global bot-debater capacity (ADR 0058, ADR 0106). An AI
 * judge is not a bot debater, so a cast whose only bots judge spends nothing.
 */
export const castSeatsBotDebater = (
  room: Pick<RoomAssemblyState, 'participants'>,
): boolean =>
  room.participants.some(
    (p) =>
      p.kind === 'bot' && (debateSides as readonly string[]).includes(p.role),
  );
