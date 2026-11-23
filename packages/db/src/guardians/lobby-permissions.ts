import { seasonStatuses } from '../schema/seasons';
import { guardianLinkStatuses } from '@daisy/protocol/guardians';
import { listedWord } from '../lifecycle-sql';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AgeBand } from '@daisy/protocol/ladder';
import { query } from '../raw-rows';
import { currentTenantScope, scopeTransaction } from '../tenant-scope';
import type { Tx } from '../tx';

export const isMinorAgeBand = (ageBand: AgeBand | null) =>
  ageBand === '13-15' || ageBand === '16-17';

const readForMinor = async <Row>(
  tx: Pick<Tx, 'execute'>,
  minorUserId: string,
  schema: z.ZodType<Row>,
  statement: SQL,
) => {
  const scope = await currentTenantScope(tx);
  await scopeTransaction(tx, { ...scope, subjectUserId: minorUserId });
  try {
    return await query(tx, schema, statement);
  } finally {
    await scopeTransaction(tx, scope);
  }
};

/** Trusted standing permission, independent of the current ranked waiver. */
export async function readGuardianLobbyIds(
  tx: Pick<Tx, 'execute'>,
  minorUserId: string,
): Promise<readonly string[]> {
  const rows = await readForMinor(
    tx,
    minorUserId,
    z.object({ lobbyId: z.string() }),
    sql`select distinct permission.lobby_id as "lobbyId"
      from restriction_lobbies permission
      join guardian_links link on link.id = permission.guardian_link_id
      where link.minor_user_id = ${minorUserId}
        and permission.signed_at is not null and link.status = ${listedWord(guardianLinkStatuses, 'active')}`,
  );
  return rows.map(({ lobbyId }) => lobbyId);
}

export async function hasGuardianLobbyWaiver(
  tx: Pick<Tx, 'execute'>,
  input: {
    minorUserId: string;
    lobbyId: string;
    waiverVersion: string;
    seasonId?: string;
  },
): Promise<boolean> {
  const [row] = await readForMinor(
    tx,
    input.minorUserId,
    z.object({ signed: z.boolean() }),
    sql`select exists (
      select 1 from restriction_lobby_waivers waiver
      join guardian_links link on link.id = waiver.guardian_link_id
      join seasons season on season.id = waiver.season_id
      where link.minor_user_id = ${input.minorUserId} and link.status = ${listedWord(guardianLinkStatuses, 'active')}
        and waiver.lobby_id = ${input.lobbyId} and waiver.waiver_version = ${input.waiverVersion}
        and season.status = ${listedWord(seasonStatuses, 'active')}
        ${input.seasonId === undefined ? sql`` : sql`and waiver.season_id = ${input.seasonId}`}
    ) as signed`,
  );
  return row?.signed ?? false;
}
