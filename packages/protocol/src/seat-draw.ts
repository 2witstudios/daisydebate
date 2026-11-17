import { z } from 'zod';
import { debateSideSchema, idSchema, type DebateSide } from './primitives';

/**
 * A Room's two teams (ADR 0145). A Room seat's role names its team's
 * placement, not its side: team 1 sits in the `affirmative` seats and team 2
 * in the `negative` ones until Start round, when the Room's side rule decides
 * which side each team argues. A Round's role is always the side.
 */
export type RoomTeam = 1 | 2;
export const roomTeamSchema = z.union([z.literal(1), z.literal(2)]);

/** The seats a team sits in before Start round. */
export const teamPlacementOf = (team: RoomTeam): DebateSide =>
  team === 1 ? 'affirmative' : 'negative';

/** The team a debater placement belongs to. */
export const teamOfPlacement = (placement: DebateSide): RoomTeam =>
  placement === 'affirmative' ? 1 : 2;

/** The side a team argues under a fixed side rule. */
export const sideOfTeam = (team: RoomTeam, teamOneSide: DebateSide) =>
  (team === 1) === (teamOneSide === 'affirmative')
    ? ('affirmative' as const)
    : ('negative' as const);

const placement = z.strictObject({
  role: debateSideSchema,
  slot: z.int().nonnegative(),
});

/**
 * What one Start round's seat draw did (ADR 0145), frozen on the Round and
 * readable by anyone who may read it: nothing in it is secret. `coin` is the
 * flip's result when the sides were open, and null when the Room fixed them.
 * `moved` lists the debaters whose team or position was open, with the seat
 * they held before and the side and slot they play.
 */
export const seatDrawSchema = z.strictObject({
  algorithm: z.literal('daisy-draw-v1/seats'),
  commitment: z.string().regex(/^[0-9a-f]{64}$/),
  coin: z.enum(['kept', 'swapped']).nullable(),
  teamOneSide: debateSideSchema,
  moved: z
    .array(
      z.strictObject({
        participantId: idSchema,
        open: z
          .array(z.enum(['team', 'position']))
          .min(1)
          .readonly(),
        from: placement,
        to: placement,
      }),
    )
    .readonly(),
});
export type SeatDraw = z.infer<typeof seatDrawSchema>;
