import { debateSides, type RoomAssemblyState } from '@daisy/protocol';

/**
 * A bot debates in this cast, which is the one fact Launch acts on: the host
 * reserves a bot-debate allowance (ADR 0117) and the Round
 * takes a slot of the global bot-debater capacity (ADR 0058, ADR 0106). An AI
 * judge is not a bot debater; its own entitlement/usage accounting does not
 * make this marker true or consume bot-debater capacity.
 */
export const castSeatsBotDebater = (
  room: Pick<RoomAssemblyState, 'participants'>,
): boolean =>
  room.participants.some(
    (p) =>
      p.kind === 'bot' && (debateSides as readonly string[]).includes(p.role),
  );
