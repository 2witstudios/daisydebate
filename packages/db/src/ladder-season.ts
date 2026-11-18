import { createRefusal } from '@daisy/errors';
import type { Ladder } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { daisyOrganizationId } from './daisy-reference';

type Tx = Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0];

/**
 * A ranked Round needs Daisy's active season on its ladder's division (ADR
 * 0146), held FOR SHARE so the season cannot close under the Start that
 * freezes the Round. With none, the Room cannot start ranked.
 */
export async function lockLadderSeason(
  tx: Pick<Tx, 'execute'>,
  ladder: Ladder,
): Promise<void> {
  const active = await tx.execute(
    sql`select id from seasons where status = 'active' and organization_id = ${daisyOrganizationId} and division = ${ladder.division} for share`,
  );
  if (active.length !== 1)
    throw createRefusal('CONFLICT', 'ranked-unavailable');
}
