import { z } from 'zod';
import { idSchema } from './primitives';
import {
  affirmativeSide,
  negativeSide,
  twoSideKeys,
  type TwoSideKey,
} from './seats';
import type { FormatSeating } from './format-seating';

/** A team's side: only a two-sided format has teams and a coin (ADR 0145, TAB-6.2). */
export const teamSideSchema = z.enum(twoSideKeys);

/**
 * A Room's two teams (ADR 0145). A Room seat's role names its team's
 * placement, not its side: team 1 sits in the `affirmative` seats and team 2
 * in the `negative` ones until Start round, when the Room's side rule decides
 * which side each team argues. A Round's role is always the side.
 */
export type RoomTeam = 1 | 2;
export const roomTeamSchema = z.union([z.literal(1), z.literal(2)]);

/** The seats a team sits in before Start round. */
export const teamPlacementOf = (team: RoomTeam): TwoSideKey =>
  team === 1 ? affirmativeSide : negativeSide;

/** The team a debater placement belongs to. */
export const teamOfPlacement = (placement: TwoSideKey): RoomTeam =>
  placement === affirmativeSide ? 1 : 2;

/** The side a team argues under a fixed side rule. */
export const sideOfTeam = (team: RoomTeam, teamOneSide: TwoSideKey) =>
  (team === 1) === (teamOneSide === affirmativeSide)
    ? affirmativeSide
    : negativeSide;

const placement = z.strictObject({
  role: teamSideSchema,
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
  teamOneSide: teamSideSchema,
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

/**
 * Whether a format seats two teams (ADR 0145, TAB-6.2): exactly the
 * two-sided preset's sides and no unsided speakers. Only such a Room has
 * teams, `?` seats and a coin; every other Room's seats are its sides.
 */
export const seatsTwoTeams = (seating: FormatSeating): boolean =>
  seating.seats.speakers === 0 &&
  seating.sides.length === twoSideKeys.length &&
  seating.sides.every((side, i) => side.key === twoSideKeys[i]);

/** Two teams of the same size: the only Rooms whose sides may swap or flip. */
export const sidesSwappable = (seating: FormatSeating): boolean =>
  seatsTwoTeams(seating) &&
  seating.seats.sides[affirmativeSide] === seating.seats.sides[negativeSide];
