import {
  isDebatingSeat,
  ageBands,
  type RoomAssemblyState,
} from '@daisy/protocol';
import { mayDebate } from '@daisy/protocol/lobby/eligibility';
import { createRefusal } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { divisionAgeBand } from './ladder-division-band';
import { query } from './raw-rows';
import type { Tx } from './tx';

/** Recheck the standing Room's cast under the Start account fences. */
export async function refuseIneligibleDebaters(
  tx: Pick<Tx, 'execute'>,
  room: RoomAssemblyState,
): Promise<void> {
  if (room.hostActorId === null) return;
  const debaters = room.participants.filter(
    (p) => p.kind === 'human' && isDebatingSeat(p.seat),
  );
  if (debaters.length === 0) return;
  const rows = await query(
    tx,
    z.object({ id: z.string(), ageBand: z.enum(ageBands).nullable() }),
    sql`select a.id, ${divisionAgeBand()} as "ageBand"
      from actors a left join account_age on account_age.user_id=a.user_id
      where a.id in (${sql.join(
        debaters.map((p) => sql`${p.actorId}`),
        sql`, `,
      )})`,
  );
  const fits = debaters.every((p) =>
    mayDebate(
      {
        ageBand: rows.find((row) => row.id === p.actorId)?.ageBand ?? null,
        guardianAllowed: false,
      },
      room,
    ),
  );
  if (!fits) throw createRefusal('CONFLICT', 'other-division');
}
