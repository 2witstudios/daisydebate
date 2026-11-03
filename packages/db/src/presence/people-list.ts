import type { AgeBand } from '@daisy/auth';
import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  idSchema,
  type ChosenStatus,
  type MemberPlacement,
  type PeopleFilter,
} from '@daisy/protocol';
import {
  readOwnCollection,
  requireOwnScope,
  type AuthorizationTransaction,
  type OwnCollectionFence,
} from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { admittedParticipant } from '../participant-admission';
import { roomIsOpen } from '../room-open';

type PeopleListScope = { readonly userId: string; readonly actorId: string };

/** Rooms' and Rounds' published fact, for the membership row `m` joined to `rooms`. */
const placementSql = sql<MemberPlacement>`case
  when rooms.id is null then null
  when ${roomIsOpen()} then 'room'
  else 'round' end`;

/**
 * Presence's published read for another query: where the member named by
 * `actorId` is. Null when they hold no active Room.
 */
export const placementOf = (actorId: SQL) =>
  sql<MemberPlacement>`(select ${placementSql} from room_active_memberships m join rooms on rooms.id = m.room_id where m.actor_id = ${actorId})`;

export type PersonRow = {
  readonly actorId: string;
  readonly username: string;
  readonly chosen: ChosenStatus;
  readonly placement: MemberPlacement;
  readonly friend: boolean;
  readonly online: boolean;
  readonly requesterActorId: string | null;
  readonly friendshipState: 'pending' | 'accepted' | null;
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
  where a.kind = 'human' and a.id <> ${viewerId}
    and ${admittedParticipant(sql`u.id`, at, admittedAgeBands)}
    and not coalesce(p.low_blocks_high or p.high_blocks_low, false)`;

const isFriend = sql`coalesce(f.state = 'accepted', false)`;

/** Appearing offline reads exactly as holding no lease, so nothing tells which. */
const isOnline = (ids: readonly string[]) =>
  sql`(a.id = any(${textArray(ids)}) and coalesce(ps.chosen_status, 'online') <> 'appearing_offline')`;

/** One keyset page, friends first, then online, then by name, and the list's totals. */
export function readPeopleListPage(
  database: BunSQLDatabase,
  scope: PeopleListScope,
  input: PeopleListPageInput,
  authorize: OwnCollectionFence<PeopleListScope>,
): Promise<PeopleListPage> {
  requireOwnScope(scope);
  for (const id of input.onlineActorIds) idSchema.parse(id);
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const self = await readSelf(tx, scope.actorId);
    const from = visibleFrom(
      scope.actorId,
      new Date(input.now),
      input.admittedAgeBands,
    );
    const online = isOnline(input.onlineActorIds);
    const [counts] = (await tx.execute(
      sql`select count(*)::int as everyone,
        count(*) filter (where ${isFriend})::int as friends,
        count(*) filter (where ${online})::int as online ${from}`,
    )) as unknown as PeopleListPage['counts'][];
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
    const rows = (await tx.execute(sql`
      select a.id as "actorId", u.username,
        coalesce(ps.chosen_status, 'online') as chosen,
        ${placementOf(sql`a.id`)} as placement,
        ${isFriend} as friend,
        ${online} as online,
        f.requester_actor_id as "requesterActorId",
        f.state as "friendshipState"
      ${from} ${named} ${friendsOnly} ${after}
      order by ${rank}, ${presence}, lower(u.username), a.id
      limit ${input.limit}`)) as unknown as PersonRow[];
    return {
      rows: [...rows],
      counts: counts ?? { everyone: 0, friends: 0, online: 0 },
      self,
    };
  });
}

const readSelf = async (tx: AuthorizationTransaction, actorId: string) => {
  const [row] = (await tx.execute(sql`
    select coalesce((select chosen_status from presence_settings where actor_id = ${actorId}), 'online') as chosen,
      ${placementOf(sql`${actorId}`)} as placement`)) as unknown as {
    chosen: ChosenStatus;
    placement: MemberPlacement;
  }[];
  return row ?? { chosen: 'online' as const, placement: null };
};

/** Whether a member can take a challenge now: their choice and placement. */
export async function readAvailability(
  tx: AuthorizationTransaction,
  actorId: string,
) {
  return readSelf(tx, actorId);
}

/** The people list's read (ADR 0105), instrumented. */
export const peopleListOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
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
