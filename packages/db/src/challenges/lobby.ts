import { and, eq, isNull, sql } from 'drizzle-orm';
import { ageBands } from '@daisy/protocol/ladder';
import { type CompetitionType } from '@daisy/protocol/round';
import { z } from 'zod';
import {
  challengeModes,
  isMinorAgeBand,
  type ChallengeDebater,
  type StandingLobbyChoice,
} from '@daisy/protocol/lobby/eligibility';
import { divisionAgeBand } from '../ladder-division-band';
import { readOfficialStandingLobbies } from '../official-standing-lobbies';
import { readGuardianLobbyIds } from '../guardians/lobby-permissions';
import { actors } from '../schema/actors';
import { query } from '../raw-rows';
import { users } from '../schema/users';
import type { Tx } from '../tx';

/** Read each candidate's age using that candidate's season, with one query
 * for the whole pair or People page. The default band only orders choices. */
export async function readChallengeDebaters(
  tx: Pick<Tx, 'execute'>,
  userIds: readonly string[],
  choices: readonly StandingLobbyChoice[],
): Promise<ReadonlyMap<string, ChallengeDebater>> {
  const result = new Map<string, ChallengeDebater>();
  if (userIds.length === 0 || choices.length === 0) return result;
  const rows = await query(
    tx,
    z.object({
      userId: z.string(),
      lobbyId: z.string(),
      ageBand: z.enum(ageBands).nullable(),
      preferredAgeBand: z.enum(ageBands).nullable(),
    }),
    sql`select subject.user_id as "userId", lobby.id as "lobbyId",
           ${divisionAgeBand(sql`lobby.id`)} as "ageBand",
           ${divisionAgeBand()} as "preferredAgeBand"
    from (values ${sql.join(
      userIds.map((id) => sql`(${id}::text)`),
      sql`, `,
    )}) subject(user_id)
    cross join lobbies lobby
    left join account_age on account_age.user_id = subject.user_id
    where lobby.id in (${sql.join(
      choices.map(({ id }) => sql`${id}`),
      sql`, `,
    )})`,
  );
  const subjects = new Map<string, typeof rows>();
  for (const row of rows) {
    const bands = subjects.get(row.userId);
    if (bands) bands.push(row);
    else subjects.set(row.userId, [row]);
  }
  for (const [userId, bands] of subjects) {
    result.set(userId, {
      preferredAgeBand: bands[0]?.preferredAgeBand ?? null,
      ageByLobby: new Map(
        bands.map(({ lobbyId, ageBand }) => [lobbyId, ageBand]),
      ),
      guardianLobbyIds: bands.some(({ ageBand }) => isMinorAgeBand(ageBand))
        ? await readGuardianLobbyIds(tx, userId)
        : [],
    });
  }
  return result;
}

export async function readProfileChallengeModes(
  tx: Pick<Tx, 'select' | 'execute'>,
  userId: string,
  username: string,
): Promise<readonly CompetitionType[]> {
  const [other] = await tx
    .select({ userId: users.id })
    .from(users)
    .innerJoin(actors, eq(actors.userId, users.id))
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.emailVerified, true),
        eq(sql`lower(${users.username})`, username.toLowerCase()),
        sql`not exists (
        select 1 from actors viewer join contact_pairs pair
          on pair.low_actor_id=least(viewer.id,${actors.id})
          and pair.high_actor_id=greatest(viewer.id,${actors.id})
        where viewer.user_id=${userId}
          and (pair.low_blocks_high or pair.high_blocks_low)
      )`,
      ),
    );
  if (!other) return [];
  const lobbies = await readOfficialStandingLobbies(tx);
  const debaters = await readChallengeDebaters(
    tx,
    [userId, other.userId],
    lobbies,
  );
  return challengeModes(
    lobbies,
    debaters.get(userId),
    debaters.get(other.userId),
  );
}
