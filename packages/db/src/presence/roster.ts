import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  idSchema,
  type ChosenStatus,
  type MemberPlacement,
  type OnlineFilter,
} from '@daisy/protocol';
import {
  readOwnCollection,
  requireOwnScope,
  type AuthorizationTransaction,
  type OwnCollectionFence,
} from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { restrictionInForce } from '../moderation/in-force';
import { roomIsOpen } from '../room-open';

type RosterScope = { readonly userId: string; readonly actorId: string };

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

export type RosterRow = {
  readonly actorId: string;
  readonly username: string;
  readonly chosen: ChosenStatus;
  readonly placement: MemberPlacement;
  readonly friend: boolean;
  readonly online: boolean;
  readonly requesterActorId: string | null;
  readonly friendshipState: 'pending' | 'accepted' | null;
};

export type RosterCursor = {
  readonly friend: boolean;
  readonly online: boolean;
  readonly username: string;
  readonly actorId: string;
};

export type RosterPageInput = {
  /**
   * Live leases, read from Redis by the caller. They say who counts as online,
   * never who is listed, and presence grants nothing.
   */
  readonly onlineActorIds: readonly string[];
  readonly now: string;
  readonly filter: OnlineFilter;
  readonly query: string | null;
  readonly after: RosterCursor | null;
  readonly limit: number;
};

export type RosterPage = {
  readonly rows: readonly RosterRow[];
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
export const ROSTER_ACTORS_MAX = 10_000;

/** One bound value however many ids: every id was validated above. */
const textArray = (values: readonly string[]) =>
  sql`string_to_array(${values.join(',')}, ',')`;

/**
 * Who this reader may see (ADR 0105): every named, current, admitted human
 * other than the reader, with no block either way. Beta approval needs an
 * admitted age and age only rises, so approval stands for the age rule without
 * reading birth data here. The block filter is why this is an HTTP read rather
 * than a shared observed body.
 */
const visibleFrom = (viewerId: string, at: Date) => sql`
  from actors a
  join users u on u.id = a.user_id and u.deleted_at is null
    and u.username is not null and u.email_verified
  join account_beta_access b on b.user_id = u.id and b.state = 'approved'
  left join presence_settings ps on ps.actor_id = a.id
  left join contact_pairs p on p.low_actor_id = least(a.id, ${viewerId})
    and p.high_actor_id = greatest(a.id, ${viewerId})
  left join friendships f on f.low_actor_id = least(a.id, ${viewerId})
    and f.high_actor_id = greatest(a.id, ${viewerId})
  where a.kind = 'human' and a.id <> ${viewerId}
    and not ${restrictionInForce(sql`u.id`, at)}
    and not coalesce(p.low_blocks_high or p.high_blocks_low, false)`;

const isFriend = sql`coalesce(f.state = 'accepted', false)`;

/** Appearing offline reads exactly as holding no lease, so nothing tells which. */
const isOnline = (ids: readonly string[]) =>
  sql`(a.id = any(${textArray(ids)}) and coalesce(ps.chosen_status, 'online') <> 'appearing_offline')`;

/** One keyset page, friends first, then online, then by name, and the list's totals. */
export function readRosterPage(
  database: BunSQLDatabase,
  scope: RosterScope,
  input: RosterPageInput,
  authorize: OwnCollectionFence<RosterScope>,
): Promise<RosterPage> {
  requireOwnScope(scope);
  for (const id of input.onlineActorIds) idSchema.parse(id);
  return readOwnCollection(database, scope, authorize, async (tx) => {
    const self = await readSelf(tx, scope.actorId);
    const from = visibleFrom(scope.actorId, new Date(input.now));
    const online = isOnline(input.onlineActorIds);
    const [counts] = (await tx.execute(
      sql`select count(*)::int as everyone,
        count(*) filter (where ${isFriend})::int as friends,
        count(*) filter (where ${online})::int as online ${from}`,
    )) as unknown as RosterPage['counts'][];
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
      limit ${input.limit}`)) as unknown as RosterRow[];
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
export const rosterOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readRosterPage: (
    scope: RosterScope,
    input: RosterPageInput,
    authorize: OwnCollectionFence<RosterScope>,
  ) =>
    instrumented(eventSink, 'readRosterPage', () =>
      readRosterPage(database, scope, input, authorize),
    ),
});
