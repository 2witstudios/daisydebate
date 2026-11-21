import { createRefusal } from '@daisy/errors';
import {
  roundCompetition,
  ratingDivisionForAgeRule,
  type CompetitionType,
  type Ladder,
} from '@daisy/protocol';
import type { LobbyAgeRule } from '@daisy/protocol/lobby/eligibility';
import { sql } from 'drizzle-orm';
import { query } from './raw-rows';
import type { Tx } from './tx';
import { z } from 'zod';

/** The existing rating ledger keys remain in use until ladders belong to lobbies. */
export const legacyRoomCompetition = (room: {
  readonly competitionType: CompetitionType;
  readonly formatId: string;
  readonly ageRule: LobbyAgeRule;
}) =>
  roundCompetition({
    ...room,
    division: ratingDivisionForAgeRule(room.ageRule),
  });

/**
 * A ranked Round needs Daisy's active season on its ladder's division (ADR
 * 0147), held FOR SHARE so the season cannot close under the Start that
 * freezes the Round. With none, the Room cannot start ranked.
 */
export async function lockLadderSeason(
  tx: Pick<Tx, 'execute'>,
  ladder: Ladder,
  organizationId: string,
): Promise<void> {
  const active = await query(
    tx,
    z.object({ id: z.string() }),
    sql`select s.id from seasons s join ladders l on l.id=${ladder.style}
      and l.organization_id=s.organization_id
      where s.status='active' and s.organization_id=${organizationId}
        and s.division=${ladder.division} for share of s`,
  );
  if (active.length !== 1)
    throw createRefusal('CONFLICT', 'ranked-unavailable');
}
