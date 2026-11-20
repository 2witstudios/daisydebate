import {
  isDebatingSeat,
  seatAllowed,
  type RatingDivision,
  type RoomAssemblyState,
  ratingDivisions,
} from '@daisy/protocol';
import { createRefusal } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { query } from './raw-rows';
import type { Tx } from './tx';
import { z } from 'zod';

/**
 * Start's own check that every seated human debater still fits the Room's
 * lobby (ADR 0156), read now as every seat command reads it: a seating made
 * before the Room had a division, or a division that changed while seated,
 * never launches a Round rated on the wrong ladder. An event Room seats its
 * organiser's admitted cast and is left to its entries.
 */
export async function refuseDebatersOffDivision(
  tx: Tx,
  room: RoomAssemblyState,
): Promise<void> {
  if (room.hostActorId === null) return;
  const debaters = room.participants.filter(
    (p) => p.kind === 'human' && isDebatingSeat(p.seat),
  );
  if (debaters.length === 0) return;
  const rows = await query(
    tx,
    z.object({ id: z.string(), division: z.enum(ratingDivisions).nullable() }),
    sql`select a.id, ${divisionOfBandSql(divisionAgeBand())} as division
      from actors a left join account_age on account_age.user_id = a.user_id
      where a.id in (${sql.join(
        debaters.map((p) => sql`${p.actorId}`),
        sql`, `,
      )})`,
  );
  const fits = debaters.every((p) =>
    seatAllowed(
      {
        kind: 'human',
        division: rows.find((row) => row.id === p.actorId)?.division ?? null,
      },
      room,
      p.seat,
    ),
  );
  if (!fits) throw createRefusal('CONFLICT', 'other-division');
}
