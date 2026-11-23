import { storedFriendshipStates } from '@daisy/protocol/friends';
import { actorKinds } from '../schema/actors';
import { listedWord } from '../lifecycle-sql';
import type { AgeBand, RatingDivision } from '@daisy/protocol/ladder';
import type { CompetitionType } from '@daisy/protocol/round';
import { ageBands, divisionOfAgeBand } from '@daisy/protocol/ladder';
import { challengeModes } from '@daisy/protocol/lobby/eligibility';
import { readChallengeDebaters } from '../challenges/lobby';
import { readOfficialStandingLobbies } from '../official-standing-lobbies';
import { divisionAgeBand } from '../ladder-division-band';
import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol/primitives';
import {
  type ChosenStatus,
  type MemberPlacement,
} from '@daisy/protocol/presence-setting';
import { type PeopleFilter } from '@daisy/protocol/people-list';
import {
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from '../authorization';
import { placementOf, readAvailability } from './availability';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { admittedParticipant } from '../participant-admission';
import type { TxSource } from '../tx';
import { query as queryRows } from '../raw-rows';
import { z } from 'zod';

type PeopleListScope = { readonly userId: string; readonly actorId: string };

export type PersonRow = {
  readonly actorId: string;
  readonly username: string;
  readonly chosen: ChosenStatus;
  readonly placement: MemberPlacement;
  readonly friend: boolean;
  readonly online: boolean;
  readonly requesterActorId: string | null;
  readonly friendshipState: 'pending' | 'accepted' | null;
  /**
   * The ladder division this member debates on (ADR 0147), from their age
   * record, so a card names it even before they are rated; never an age.
   */
  readonly division: RatingDivision | null;
  readonly challengeModes: readonly CompetitionType[];
};

export type PeopleListCursor = {
  readonly friend: boolean;
  readonly online: boolean;
  readonly username: string;
  readonly actorId: string;
};

export type PeopleListPageInput = {
  /**
   * Live leases, read from Redis by the caller. They say who counts as online,
   * never who is listed, and presence grants nothing.
   */
  readonly onlineActorIds: readonly string[];
  /** The bands the one admission rule admits, from `@daisy/auth`. */
  readonly admittedAgeBands: readonly AgeBand[];
  readonly now: string;
  readonly filter: PeopleFilter;
  readonly query: string | null;
  readonly after: PeopleListCursor | null;
  readonly limit: number;
};

export type PeopleListPage = {
  readonly rows: readonly PersonRow[];
  readonly counts: {
    readonly everyone: number;
    readonly friends: number;
    readonly online: number;
  };
  readonly self: {
    readonly chosen: ChosenStatus;
    readonly placement: MemberPlacement;
  };
};

/** The most leases one read considers; the caller's Redis scan stops here. */
export const ONLINE_LEASES_MAX = 10_000;

/** One bound value however many ids: every id was validated above. */
const textArray = (values: readonly string[]) =>
  sql`string_to_array(${values.join(',')}, ',')`;

/**
 * Who this reader may see (ADR 0105): every named, current, admitted human
 * other than the reader, with no block either way. The block filter is why
 * this is an HTTP read rather than a shared observed body.
 */
const visibleFrom = (
  viewerId: string,
  at: Date,
  admittedAgeBands: readonly AgeBand[],
) => sql`
  from actors a
  join users u on u.id = a.user_id and u.deleted_at is null
    and u.username is not null and u.email_verified
  left join presence_settings ps on ps.actor_id = a.id
  left join contact_pairs p on p.low_actor_id = least(a.id, ${viewerId})
    and p.high_actor_id = greatest(a.id, ${viewerId})
  left join friendships f on f.low_actor_id = least(a.id, ${viewerId})
    and f.high_actor_id = greatest(a.id, ${viewerId})
  where a.kind = ${listedWord(actorKinds, 'human')} and a.id <> ${viewerId}
    and ${admittedParticipant(sql`u.id`, at, admittedAgeBands)}
    and not coalesce(p.low_blocks_high or p.high_blocks_low, false)`;

const isFriend = sql`coalesce(f.state = ${listedWord(storedFriendshipStates, 'accepted')}, false)`;

/** Appearing offline reads exactly as holding no lease, so nothing tells which. */
const isOnline = (ids: readonly string[]) =>
  sql`(a.id = any(${textArray(ids)}) and coalesce(ps.chosen_status, 'online') <> 'appearing_offline')`;

/** One keyset page, friends first, then online, then by name, and the list's totals. */
export function readPeopleListPage(
  database: TxSource,
  scope: PeopleListScope,
  input: PeopleListPageInput,
  authorize: OwnCollectionFence<PeopleListScope>,
): Promise<PeopleListPage> {
  requireOwnScope(scope);
  for (const id of input.onlineActorIds) idSchema.parse(id);
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const self = await readAvailability(tx, scope.actorId);
    const from = visibleFrom(
      scope.actorId,
      new Date(input.now),
      input.admittedAgeBands,
    );
    const online = isOnline(input.onlineActorIds);
    const [counts] = await queryRows(
      tx,
      z.object({
        everyone: z.number(),
        friends: z.number(),
        online: z.number(),
      }),
      sql`select count(*)::int as everyone,
        count(*) filter (where ${isFriend})::int as friends,
        count(*) filter (where ${online})::int as online ${from}`,
    );
    const rank = sql`case when ${isFriend} then 0 else 1 end`;
    const presence = sql`case when ${online} then 0 else 1 end`;
    const after = input.after
      ? sql`and (${rank}, ${presence}, lower(u.username), a.id) > (${input.after.friend ? 0 : 1}, ${input.after.online ? 0 : 1}, ${input.after.username.toLowerCase()}, ${input.after.actorId})`
      : sql``;
    const named = input.query
      ? sql`and position(${input.query.toLowerCase()} in lower(u.username)) > 0`
      : sql``;
    const friendsOnly =
      input.filter === 'friends' ? sql`and ${isFriend}` : sql``;
    const rows = await queryRows(
      tx,
      z.object({
        actorId: z.string(),
        userId: z.string(),
        username: z.string(),
        chosen: z.enum(['online', 'busy', 'appearing_offline']),
        placement: z.enum(['round', 'room']).nullable(),
        friend: z.boolean(),
        online: z.boolean(),
        requesterActorId: z.string().nullable(),
        friendshipState: z.enum(['pending', 'accepted']).nullable(),
        ageBand: z.enum(ageBands).nullable(),
      }),
      sql`
      select a.id as "actorId", u.id as "userId", u.username,
        coalesce(ps.chosen_status, 'online') as chosen,
        ${placementOf(sql`a.id`)} as placement,
        ${isFriend} as friend,
        ${online} as online,
        f.requester_actor_id as "requesterActorId",
        f.state as "friendshipState",
        (select ${divisionAgeBand()} from account_age where account_age.user_id = u.id) as "ageBand"
      ${from} ${named} ${friendsOnly} ${after}
      order by ${rank}, ${presence}, lower(u.username), a.id
      limit ${input.limit}`,
    );
    const lobbies = await readOfficialStandingLobbies(tx);
    const debaters = await readChallengeDebaters(
      tx,
      [scope.userId, ...rows.map(({ userId }) => userId)],
      lobbies,
    );
    const own = debaters.get(scope.userId);
    const people = rows.map(({ ageBand, userId, ...row }) => ({
      ...row,
      division: divisionOfAgeBand(ageBand),
      challengeModes: challengeModes(lobbies, own, debaters.get(userId)),
    }));
    return {
      rows: people,
      counts: counts ?? { everyone: 0, friends: 0, online: 0 },
      self,
    };
  });
}

/** The people list's read (ADR 0105), instrumented. */
export const peopleListOperations = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readPeopleListPage: (
    scope: PeopleListScope,
    input: PeopleListPageInput,
    authorize: OwnCollectionFence<PeopleListScope>,
  ) =>
    instrumented(eventSink, 'readPeopleListPage', () =>
      readPeopleListPage(database, scope, input, authorize),
    ),
});
