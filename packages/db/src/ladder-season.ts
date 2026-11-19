import { createRefusal } from '@daisy/errors';
import type { Ladder } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { daisyOrganizationId } from './daisy-reference';
import type { Tx } from './tx';

/**
 * A ranked Round needs Daisy's active season on its ladder's division (ADR
 * 0147), held FOR SHARE so the season cannot close under the Start that
 * freezes the Round. With none, the Room cannot start ranked.
 */
export async function lockLadderSeason(tx: Tx, ladder: Ladder): Promise<void> {
  const active = await tx.execute(
    sql`select id from seasons where status = 'active' and organization_id = ${daisyOrganizationId} and division = ${ladder.division} for share`,
  );
  if (active.length !== 1)
    throw createRefusal('CONFLICT', 'ranked-unavailable');
}
