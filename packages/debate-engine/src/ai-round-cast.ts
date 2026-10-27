import { debateSides, type RoomAssemblyState } from '@daisy/protocol';

/**
 * DEC-186 as amended 2026-10-26: a non-ranked Round spends one host AI-round
 * allowance only when a bot debates. An AI judge is free, so a cast whose only
 * bots judge spends nothing.
 */
export const castSpendsAiRound = (
  room: Pick<RoomAssemblyState, 'competitionType' | 'participants'>,
): boolean =>
  room.competitionType !== 'ranked' &&
  room.participants.some(
    (p) =>
      p.kind === 'bot' && (debateSides as readonly string[]).includes(p.role),
  );
