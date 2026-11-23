import { isDebatingSeat, type SeatRef } from '@daisy/protocol/seats';
import { type RoomAssemblyState } from '@daisy/protocol/room-contract';

/**
 * One seat holds a bot debater: a bot in a debating seat. An AI judge is a
 * bot in a judge seat and is not one. The cast rule below and the early
 * bot-debates release refusals (ADR 0921) both decide from this.
 */
export const isBotDebater = (seat: {
  readonly kind: 'human' | 'bot';
  readonly seat: SeatRef;
}): boolean => seat.kind === 'bot' && isDebatingSeat(seat.seat);

/**
 * A bot debates in this cast, which is the one fact Launch acts on: the host
 * reserves a bot-debate allowance (ADR 0117) and the Round
 * takes a slot of the global bot-debater capacity (ADR 0058, ADR 0106). An AI
 * judge is not a bot debater; its own entitlement/usage accounting does not
 * make this marker true or consume bot-debater capacity.
 */
export const castSeatsBotDebater = (
  room: Pick<RoomAssemblyState, 'participants'>,
): boolean => room.participants.some(isBotDebater);
