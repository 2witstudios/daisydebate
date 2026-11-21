import { lifecycleSql, lifecycleSqlList } from './lifecycle-sql';
import { sql, type SQL } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { defaultStandingLobby } from '@daisy/protocol/lobby/eligibility';
import {
  runningRoundStatuses,
  openRoomStatuses,
  roomStatus,
  roomListQuerySchema,
  roomListPageSchema,
  seatKindSchema,
  type RoomListQuery,
  type RoomListEntry,
  type RoomListPage,
  type SeatRef,
} from '@daisy/protocol';
import { seatOfColumns } from './seat-columns';
import { sharedAccount, type Caller, type Account } from './room-command-facts';
import { loadAuthorizationAccount } from './authorization';
import { currentRoomTopic, type ReadOpeningTopic } from './round-opening-read';
import type { Tx } from './tx';
import { run, query as queryRows } from './raw-rows';
import { z } from 'zod';
import { readOfficialStandingLobbies } from './official-standing-lobbies';
import { readCompetitionAgeBand } from './ladder-division-band';
import { scopeTransaction } from './tenant-scope';
type Seat = {
  readonly actorId: string;
  readonly seat: SeatRef;
};
export type RoomDiscoveryFact = Pick<
  RoomListEntry,
  'id' | 'version' | 'visibility' | 'status'
> & {
  readonly hostActorId: string | null;
  /** The host occupies a human judge seat; who may name them is the caller's rule. */
  readonly hostIsHumanJudge: boolean;
  readonly participants: readonly Seat[];
  readonly round: null | {
    readonly kind: 'round';
    readonly roundId: string;
    readonly revision: number;
    readonly createdByActorId: string | null;
    readonly visibility: RoomListEntry['visibility'];
    readonly status: string;
    readonly participants: readonly Seat[];
  };
};
const hostLabel = sql`case when h.kind = 'bot' then coalesce(b.name,'') when u.deleted_at is null then coalesce(u.username,'') else '' end`;
const joins = sql`left join actors h on h.id=r.host_actor_id left join users u on u.id=h.user_id left join bot_profiles b on b.actor_id=h.id`;
const hostIsHumanJudge = sql`(h.kind='human' and exists(select 1 from room_participants j where j.room_id=r.id and j.actor_id=r.host_actor_id and j.seat_kind='judge'))`;
const visible = (caller: Caller) =>
  sql`(r.visibility='public' or r.host_actor_id=${caller.actorId} or exists(select 1 from room_participants p where p.room_id=r.id and p.actor_id=${caller.actorId} limit 1 offset 0))`;
/**
 * A live Round is only ever listed to who is in it, and scoped here, before search
 * and paging, so a search for its resolution or host answers an outsider exactly as a
 * miss does (WATCH-6). The audience reaches a live Round through the Live listing.
 */
const inLaunchedRound = (caller: Caller) =>
  sql`(r.host_actor_id=${caller.actorId} or d.created_by_actor_id=${caller.actorId} or exists(select 1 from round_participants p where p.round_id=d.id and p.actor_id=${caller.actorId} limit 1 offset 0))`;
/** The open-Room states a status filter selects; live Rooms come from their Round. */
const assemblyStatuses = (status: RoomListQuery['status']) =>
  status === 'open'
    ? lifecycleSqlList([roomStatus.assembling])
    : status === 'starting'
      ? lifecycleSqlList([roomStatus.ready])
      : lifecycleSqlList(openRoomStatuses);
/** Which discovery branches a status filter keeps: open Rooms, launched ones or both. */
const statusScope = (status: RoomListQuery['status']) => ({
  assembly: status !== 'live',
  launched: status === undefined || status === 'live',
});
const modeMatches = (mode: RoomListQuery['mode']) =>
  mode === undefined ? sql`true` : sql`r.competition_type=${mode}`;
const lobbyMatches = (lobbyId: string) => sql`r.lobby_id=${lobbyId}`;
/** Free judge seats of the Room's rules, read with the page. */
const openJudgeSeats = sql`greatest(0, (r.rules_snapshot->'seats'->>'judges')::int - (select count(*)::int from room_participants j where j.room_id=r.id and j.seat_kind='judge'))`;
/** Seat totals and the format label, read with the page; never a lock target. */
const seatCount = sql`((select coalesce(sum(n.count::int),0) from jsonb_each_text(r.rules_snapshot->'seats'->'sides') as n(side,count))::int+(r.rules_snapshot->'seats'->>'speakers')::int+(r.rules_snapshot->'seats'->>'judges')::int+(r.rules_snapshot->'seats'->>'moderators')::int)`;
const seatsTaken = sql`case when r.status=${lifecycleSql(roomStatus.started)} then (select count(*)::int from round_participants s where s.round_id=d.id) else (select count(*)::int from room_participants s where s.room_id=r.id) end`;
const search = (q: string, topic: SQL) =>
  sql`(${q}='' or strpos(lower(r.title),lower(${q}))>0 or strpos(lower(${topic}),lower(${q}))>0 or (strpos(lower(${hostLabel}),lower(${q}))>0 and not ${hostIsHumanJudge}))`;
// Hostless event Rooms publish their waiting topic through Tab's scoped read.
// Discovery search uses the same topic as its response. An existing Round
// supplies its own opening resolution.
const waitingTopic = sql`case when r.lobby_kind <> 'tournament' then r.topic end`;
const launchedTopic = sql`coalesce(d.resolution,${waitingTopic})`;
/** The driver returns a timestamp, or JSON's string for one, as a canonical ISO instant. */
const isoOrNull = (value: Date | string | null) =>
  value === null ? null : new Date(value).toISOString();
/** Immutable across launch: the cursor's Room remains the timestamp witness. */
const pageOrder = (
  sort: RoomListQuery['sort'],
  cursor: string | undefined,
  caller: Caller,
  lobbyId: string,
) => {
  const direction = sort === 'longest-waiting' ? sql`asc` : sql`desc`;
  return {
    direction,
    after:
      cursor === undefined
        ? sql`true`
        : sql`(r.created_at, r.id collate "C") ${sort === 'longest-waiting' ? sql`>` : sql`<`}
      (select r.created_at, r.id collate "C" from rooms r
        where r.id=${cursor} and ${lobbyMatches(lobbyId)} and ${visible(caller)})`,
  };
};
/** Bound candidates before locks; a race may shorten a page, never trigger replenishment. */
export async function discoverRooms(
  tx: Tx,
  caller: Caller,
  input: RoomListQuery,
  authorize: (fact: RoomDiscoveryFact, account: Account) => boolean,
  authorizeCollection: (account: Account) => boolean,
  hostHidden: (fact: RoomDiscoveryFact) => boolean,
  readTopic: ReadOpeningTopic,
): Promise<RoomListPage> {
  const parsed = roomListQuerySchema.safeParse(input);
  if (!parsed.success) throw createAppError('VALIDATION');
  const { cursor, pageSize, q, status, mode, sort } = parsed.data;
  const { assembly, launched } = statusScope(status);
  let account = await sharedAccount(tx, caller);
  if (!authorizeCollection(account)) throw createAppError('AUTHORIZATION');
  const official = await readOfficialStandingLobbies(tx);
  const lobby = parsed.data.lobbyId
    ? official.find(({ id }) => id === parsed.data.lobbyId)
    : defaultStandingLobby(
        official,
        await readCompetitionAgeBand(tx, caller.userId),
      );
  if (!lobby) return { rooms: [], nextCursor: null, retry: false };
  const order = pageOrder(sort, cursor, caller, lobby.id);
  const candidates = await queryRows(
    tx,
    z.object({ id: z.string() }),
    sql`
  select id from (
    (select r.id,r.created_at from rooms r ${joins}
      where ${assembly} and r.status in ${assemblyStatuses(status)} and ${modeMatches(mode)} and ${lobbyMatches(lobby.id)} and ${order.after} and ${visible(caller)} and ${search(q, waitingTopic)}
      order by r.created_at ${order.direction},r.id collate "C" ${order.direction} limit ${pageSize + 1})
    union all
    (select r.id,r.created_at from rounds d join rooms r on r.id=d.room_id ${joins}
      where ${launched} and ${modeMatches(mode)} and ${lobbyMatches(lobby.id)} and d.status in ${lifecycleSqlList(runningRoundStatuses)} and d.room_id is not null and r.status=${lifecycleSql(roomStatus.started)}
        and ${order.after} and ${visible(caller)} and ${inLaunchedRound(caller)} and ${search(q, launchedTopic)}
      order by r.created_at ${order.direction},r.id collate "C" ${order.direction} limit ${pageSize + 1})
  ) candidates order by created_at ${order.direction},id collate "C" ${order.direction} limit ${pageSize + 1}
 `,
  );
  const ids = candidates.slice(0, pageSize).map((r) => r.id);
  const more = candidates.length > pageSize;
  if (!ids.length) return { rooms: [], nextCursor: null, retry: false };
  const idSet = sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  await run(
    tx,
    sql`select id from rooms where id=any(${idSet}) order by id for share`,
  );
  await run(
    tx,
    sql`select id from rounds where room_id=any(${idSet}) order by id for share`,
  );
  // Producer facts are read again after every downstream lock wait.
  account = await loadAuthorizationAccount(tx, caller.userId);
  if (!authorizeCollection(account)) throw createAppError('AUTHORIZATION');
  await scopeTransaction(tx, { lobbyId: lobby.id });
  const fields = roomListPageSchema.shape.rooms.unwrap().element.shape;
  const rowSchema = z.object({
    ...fields,
    waitingSince: z.union([z.date(), z.string()]).nullable(),
    live: z
      .object({
        stage: fields.live.unwrap().shape.stage,
        startedAt: z.union([z.date(), z.string()]).nullable(),
      })
      .nullable(),
    seatKind: seatKindSchema.nullable(),
    side: z.string().nullable(),
    slot: z.int().nullable(),
    roundVersion: z.int().nullable(),
    roundCreator: z.string().nullable(),
    roundVisibility: fields.visibility.nullable(),
    roundSeatKind: seatKindSchema.nullable(),
    roundSide: z.string().nullable(),
    roundSlot: z.int().nullable(),
    hostIsHumanJudge: z.boolean().nullable(),
  });
  const rows = await queryRows(
    tx,
    rowSchema,
    sql`
  select r.id,r.version,r.title,${launchedTopic} as topic,r.visibility,r.host_actor_id as "hostActorId",
   ${hostLabel} as "hostLabel",${hostIsHumanJudge} as "hostIsHumanJudge",r.status,r.competition_type as "competitionType",
   p.actor_id is not null as seated,p.seat_kind as "seatKind",p.side,p.slot,
   case when r.status=${lifecycleSql(roomStatus.started)} then json_build_object('id',d.id,'status',d.status) else null end as "roundRef",
   d.version as "roundVersion",d.created_by_actor_id as "roundCreator",d.visibility as "roundVisibility",rp.seat_kind as "roundSeatKind",rp.side as "roundSide",rp.slot as "roundSlot",
   f.name as "formatLabel",${seatsTaken} as "seatsTaken",${seatCount} as "seatCount",
   case when r.status in ${lifecycleSqlList(openRoomStatuses)} then r.created_at end as "waitingSince",
   case when r.status=${lifecycleSql(roomStatus.started)} then json_build_object('stage',d.current_stage,'startedAt',d.started_at) else null end as "live",
   null::int as "hostRating",r.lobby_id as "lobbyId",lb.age_rule as "ageRule",
   ${openJudgeSeats} as "openJudgeSeats"
  from rooms r ${joins}
  join formats f on f.id=r.format_id
  join lobbies lb on lb.id=r.lobby_id
  left join room_participants p on p.room_id=r.id and p.actor_id=${caller.actorId}
  left join rounds d on d.room_id=r.id
  left join round_participants rp on rp.round_id=d.id and rp.actor_id=${caller.actorId}
  where r.id=any(${idSet}) and ${visible(caller)} and ${search(q, launchedTopic)}
   and ${modeMatches(mode)} and ${lobbyMatches(lobby.id)}
   and ((${assembly} and r.status in ${assemblyStatuses(status)}) or (${launched} and r.status=${lifecycleSql(roomStatus.started)} and d.status in ${lifecycleSqlList(runningRoundStatuses)} and ${inLaunchedRound(caller)}))
  order by r.created_at ${order.direction},r.id collate "C" ${order.direction}
 `,
  );
  const fact = (r: (typeof rows)[number]): RoomDiscoveryFact => ({
    ...r,
    hostIsHumanJudge: r.hostIsHumanJudge === true,
    participants:
      r.seated && r.seatKind && typeof r.slot === 'number'
        ? [
            {
              actorId: caller.actorId,
              seat: seatOfColumns({
                seatKind: r.seatKind,
                side: r.side,
                slot: r.slot,
              }),
            },
          ]
        : [],
    round:
      r.roundRef && r.roundVersion !== null && r.roundVisibility !== null
        ? {
            kind: 'round',
            roundId: r.roundRef.id,
            status: r.roundRef.status,
            revision: r.roundVersion,
            createdByActorId: r.roundCreator,
            visibility: r.roundVisibility,
            participants:
              r.roundSeatKind && typeof r.roundSlot === 'number'
                ? [
                    {
                      actorId: caller.actorId,
                      seat: seatOfColumns({
                        seatKind: r.roundSeatKind,
                        side: r.roundSide,
                        slot: r.roundSlot,
                      }),
                    },
                  ]
                : [],
          }
        : null,
  });
  const entries = rows
    .filter((r) => authorize(fact(r), account))
    .map((r) => ({
      ...r,
      waitingSince: isoOrNull(r.waitingSince),
      live: r.live && {
        stage: r.live.stage,
        startedAt: isoOrNull(r.live.startedAt),
      },
    }))
    .map((r) =>
      hostHidden(fact(r))
        ? { ...r, hostActorId: null, hostLabel: null, hostRating: null }
        : r,
    )
    .map(
      ({
        hostIsHumanJudge: _hostJudge,
        seatKind: _seatKind,
        side: _side,
        slot: _slot,
        roundVersion: _version,
        roundCreator: _creator,
        roundVisibility: _visibility,
        roundSeatKind: _roundSeatKind,
        roundSide: _roundSide,
        roundSlot: _roundSlot,
        ...r
      }) => r,
    );
  // One at a time: a transaction runs one query.
  const rooms: typeof entries = [];
  for (const room of entries)
    rooms.push({
      ...room,
      topic: await currentRoomTopic(tx, room, readTopic),
    });
  return {
    rooms,
    nextCursor: more ? (rooms.at(-1)?.id ?? null) : null,
    retry: rooms.length === 0 && candidates.length > 0,
  };
}
