import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  competitionTypes,
  type AgeBand,
  type CompetitionType,
} from '@daisy/protocol';
import {
  defaultStandingLobby,
  mayDebate,
  type StandingLobbyChoice,
} from '@daisy/protocol/lobby/eligibility';
import {
  divisionAgeBand,
  readCompetitionAgeBand,
} from '../ladder-division-band';
import { readOfficialStandingLobbies } from '../official-standing-lobbies';
import { actors } from '../schema/actors';
import { accountAge } from '../schema/account-age';
import { users } from '../schema/users';
import type { Tx } from '../tx';

export const sharedChallengeLobby = (
  choices: readonly StandingLobbyChoice[],
  first: AgeBand | null,
  second: AgeBand | null,
  mode: CompetitionType,
) =>
  defaultStandingLobby(
    choices.filter((lobby) =>
      [first, second].every((ageBand) =>
        mayDebate(
          { ageBand, guardianAllowed: false },
          { ageRule: lobby.ageRule, competitionType: mode },
        ),
      ),
    ),
    first,
  );

export const challengeModes = (
  choices: readonly StandingLobbyChoice[],
  own: AgeBand | null,
  their: AgeBand | null,
) =>
  competitionTypes.filter((mode) =>
    sharedChallengeLobby(choices, own, their, mode),
  );

export async function readProfileChallengeModes(
  tx: Pick<Tx, 'select'>,
  userId: string,
  username: string,
): Promise<readonly CompetitionType[]> {
  const [other] = await tx
    .select({ ageBand: divisionAgeBand() })
    .from(users)
    .innerJoin(actors, eq(actors.userId, users.id))
    .leftJoin(accountAge, eq(accountAge.userId, users.id))
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
  return challengeModes(
    await readOfficialStandingLobbies(tx),
    await readCompetitionAgeBand(tx, userId),
    other.ageBand,
  );
}
