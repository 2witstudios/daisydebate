import type { RatingDivision } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { LeagueRoomFacts } from './league-ladder-seat';
import { ladders } from './schema/ladders';
import { organizations } from './schema/organizations';

/**
 * The league facts a Room's seating reads: the division of the league whose
 * ladder the Room rates on, read in the caller's transaction.
 */
export const leagueRoomFacts = async (
  tx: Pick<BunSQLDatabase, 'select'>,
  room: { readonly leagueLadderId: string | null },
): Promise<LeagueRoomFacts> => {
  if (room.leagueLadderId === null) return { leagueDivision: null };
  const [league] = await tx
    .select({ division: organizations.leagueDivision })
    .from(ladders)
    .innerJoin(organizations, eq(organizations.id, ladders.organizationId))
    .where(eq(ladders.id, room.leagueLadderId));
  const division: RatingDivision | null | undefined = league?.division;
  // A ladder always belongs to a league, and every league has a division.
  if (!division) throw createAppError('INVARIANT');
  return { leagueDivision: division };
};
