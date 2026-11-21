import { sql } from 'drizzle-orm';
import {
  type CompetitionType,
  type RatingDivision,
  type RatingStyle,
  competitionTypes,
  ratingDivisions,
} from '@daisy/protocol';
import {
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from '../authorization';
import {
  withContactPairs,
  type ContactAuthorizationFence,
  type ContactInput,
} from '../contacts/fence';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { restrictionInForce } from '../moderation/in-force';
import { challengeOpen } from './open';
import { roomIsOpen } from '../room-open';
import { challengeFrame, type ChallengeFrame } from './frame';
import type { TxSource, Tx } from '../tx';
import { query } from '../raw-rows';
import { z } from 'zod';

/** Challenges over the shared Contacts fence (ADR 0103). */
export type ChallengeStore = {
  readonly withContacts: <T>(
    input: ContactInput,
    work: (frame: ChallengeFrame) => Promise<T>,
  ) => Promise<T>;
};

export function createChallengeStore({
  database,
  authorize,
}: {
  readonly database: TxSource;
  readonly authorize: ContactAuthorizationFence;
}): ChallengeStore {
  return {
    withContacts: (input, work) =>
      withContactPairs(database, authorize, input, async (tx, { refresh }) =>
        work(challengeFrame(tx, input, refresh)),
      ),
  };
}

type Scope = { readonly userId: string; readonly actorId: string };

type ChallengeRowFacts = {
  readonly id: string;
  readonly direction: 'incoming' | 'outgoing';
  /** The member on the other end. */
  readonly actorId: string;
  readonly username: string;
  readonly mode: CompetitionType;
  readonly format: RatingStyle;
  /** The lobby both members share (ADR 0156); its Room opens there. */
  readonly division: RatingDivision;
  readonly createdAt: string;
  readonly expiresAt: string;
};
/** An offer still waiting, or an accepted challenge with the room it opened. */
export type ChallengeListRow = ChallengeRowFacts &
  ({ readonly roomId: null } | { readonly roomId: string });

/** The most challenges one read lists, newest first, in either direction. */
const CHALLENGE_LIST_MAX = 40;

/**
 * Challenges naming this member: open offers, and ones accepted moments ago
 * whose room is still gathering. Blocked pairs and closed accounts drop out. Reads only.
 */
export function listChallenges(
  database: TxSource,
  scope: Scope,
  now: string,
  authorize: OwnCollectionFence<Scope>,
): Promise<readonly ChallengeListRow[]> {
  requireOwnScope(scope);
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const rows = await query(
      tx,
      z.object({
        format: z.literal('freestyle'),
        id: z.string(),
        division: z.enum(ratingDivisions),
        mode: z.enum(competitionTypes),
        actorId: z.string(),
        direction: z.enum(['incoming', 'outgoing']),
        username: z.string(),
        roomId: z.string().nullable(),
        createdAt: z.union([z.string(), z.date()]),
        expiresAt: z.union([z.string(), z.date()]),
      }),
      sql`
      select c.id,
        case when c.challenged_actor_id = ${scope.actorId} then 'incoming' else 'outgoing' end as direction,
        a.id as "actorId", u.username, c.mode, c.format_id as format, c.division, c.room_id as "roomId",
        c.created_at as "createdAt", c.expires_at as "expiresAt"
      from challenges c
      join actors a on a.id = case when c.challenged_actor_id = ${scope.actorId}
        then c.challenger_actor_id else c.challenged_actor_id end
      join users u on u.id = a.user_id and u.deleted_at is null and u.username is not null
      left join rooms on rooms.id = c.room_id
      left join contact_pairs p on p.low_actor_id = least(c.challenger_actor_id, c.challenged_actor_id)
        and p.high_actor_id = greatest(c.challenger_actor_id, c.challenged_actor_id)
      where (c.challenged_actor_id = ${scope.actorId} or c.challenger_actor_id = ${scope.actorId})
        and not coalesce(p.low_blocks_high or p.high_blocks_low, false)
        and not ${restrictionInForce(sql`a.user_id`, new Date(now))}
        and (${challengeOpen(sql`${new Date(now)}`, sql`c`)}
          or (c.room_id is not null and c.follow_until > ${new Date(now)} and ${roomIsOpen()}))
      order by c.created_at desc, c.id
      limit ${CHALLENGE_LIST_MAX}`,
    );
    return rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      expiresAt: new Date(row.expiresAt).toISOString(),
    }));
  });
}

/** Removes offers past their time; the list already ignores them. */
export async function purgeExpiredChallenges(
  database: Tx,
  input: { readonly now: string; readonly limit: number },
): Promise<number> {
  const rows = await query(
    database,
    z.object({ id: z.string() }),
    sql`
    delete from challenges where id in (
      select id from challenges
      where room_id is null and expires_at <= ${new Date(input.now)}
      limit ${input.limit})
    returning id`,
  );
  return rows.length;
}

/** Challenges' reads (ADR 0103), instrumented. */
export const challengeReadOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  listChallenges: (
    scope: Scope,
    now: string,
    authorize: OwnCollectionFence<Scope>,
  ) =>
    instrumented(eventSink, 'listChallenges', () =>
      listChallenges(database, scope, now, authorize),
    ),
  /**
   * The other member of a challenge naming this actor, before the command
   * takes the pair's fence. A hint only: the frame re-checks everything.
   */
  readChallengeCounterpart: (actorId: string, challengeId: string) =>
    instrumented(eventSink, 'readChallengeCounterpart', async () => {
      const [row] = await query(
        database,
        z.object({ other: z.string() }),
        sql`
        select case when challenger_actor_id = ${actorId}
          then challenged_actor_id else challenger_actor_id end as other
        from challenges
        where id = ${challengeId}
          and (challenger_actor_id = ${actorId} or challenged_actor_id = ${actorId})`,
      );
      return row?.other ?? null;
    }),
  purgeExpiredChallenges: (input: {
    readonly now: string;
    readonly limit: number;
  }) =>
    instrumented(eventSink, 'purgeExpiredChallenges', () =>
      purgeExpiredChallenges(database, input),
    ),
});
