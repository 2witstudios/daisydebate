import {
  isDebatingSeat,
  ageBands,
  type RoomAssemblyState,
} from '@daisy/protocol';
import { mayDebate } from '@daisy/protocol/lobby/eligibility';
import { createRefusal } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  isMinorAgeBand,
  readGuardianLobbyIds,
} from './guardians/lobby-permissions';
import {
  divisionAgeBand,
  readCompetitionAgeBand,
} from './ladder-division-band';
import { query } from './raw-rows';
import type { Tx } from './tx';

/** Guardian evidence follows the debater's eligibility age in an adult lobby. */
export function readGuardianWaiverAgeBand(
  tx: Pick<Tx, 'select'>,
  room: RoomAssemblyState,
  userId: string,
  actorId: string,
) {
  return room.competitionType === 'ranked' &&
    room.ageRule === 'adults' &&
    room.participants.some(
      (seat) => seat.actorId === actorId && isDebatingSeat(seat.seat),
    )
    ? readCompetitionAgeBand(tx, userId, room.lobbyId)
    : null;
}

/** Recheck the caller at Ready, or the standing Room's whole cast at Start. */
export async function refuseIneligibleDebaters(
  tx: Pick<Tx, 'execute'>,
  room: RoomAssemblyState,
  actorId?: string,
): Promise<void> {
  if (room.hostActorId === null) return;
  const debaters = room.participants.filter(
    (p) =>
      p.kind === 'human' &&
      isDebatingSeat(p.seat) &&
      (actorId === undefined || p.actorId === actorId),
  );
  if (debaters.length === 0) return;
  const rows = await query(
    tx,
    z.object({
      id: z.string(),
      userId: z.string().nullish(),
      ageBand: z.enum(ageBands).nullable(),
    }),
    sql`select a.id, a.user_id as "userId", ${divisionAgeBand(room.lobbyId)} as "ageBand"
      from actors a left join account_age on account_age.user_id=a.user_id
      where a.id in (${sql.join(
        debaters.map((p) => sql`${p.actorId}`),
        sql`, `,
      )})`,
  );
  for (const debater of debaters) {
    const member = rows.find(({ id }) => id === debater.actorId);
    const ageBand = member?.ageBand ?? null;
    const guardianLobbyIds =
      room.ageRule === 'adults' && member?.userId && isMinorAgeBand(ageBand)
        ? await readGuardianLobbyIds(tx, member.userId)
        : [];
    if (!mayDebate({ ageBand, guardianLobbyIds }, room))
      throw createRefusal('CONFLICT', 'other-division');
  }
}
