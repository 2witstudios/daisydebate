import { z } from 'zod';
import type { SeatKind, SeatRef } from './seats';

/**
 * The two AI actors a seat can hold (ISSUE-750): a bot debater, or the AI
 * judge. Each actor is one of them by its profile, never both.
 */
const aiRoles = ['debater', 'judge'] as const;
export const aiRoleSchema = z.enum(aiRoles);
export type AiRole = (typeof aiRoles)[number];

/**
 * The AI role that may fill a kind of seat: a competitor's seat (a side's or
 * an unsided speaker's) is a bot debater's, a judge's the AI judge's; no AI
 * moderates.
 */
export const aiRoleOfSeat = (kind: SeatKind): AiRole | null => {
  switch (kind) {
    case 'side':
    case 'speaker':
      return 'debater';
    case 'judge':
      return 'judge';
    case 'moderator':
      return null;
  }
};

/** Whether an AI actor in `role` may hold `seat`; an actor of no role holds none. */
export const aiRoleFits = (role: AiRole | null, seat: SeatRef): boolean =>
  role !== null && aiRoleOfSeat(seat.kind) === role;
