import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  roomListQuerySchema,
  type RoomListQuery,
  type RoomListEntry,
  type RoomListPage,
} from '@daisy/protocol';
import {
  lockedAccount,
  type Caller,
  type Account,
  type Tx,
} from './room-command-facts';
import { loadAuthorizationAccount } from './authorization';
type Seat = {
  readonly actorId: string;
  readonly role: string;
  readonly slot: number;
};
export type RoomDiscoveryFact = Pick<
  RoomListEntry,
  'id' | 'version' | 'hostActorId' | 'visibility' | 'status'
> & {
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
const visible = (caller: Caller) =>
  sql`(r.visibility='public' or r.host_actor_id=${caller.actorId} or exists(select 1 from room_participants p where p.room_id=r.id and p.actor_id=${caller.actorId} limit 1 offset 0))`;
const roundVisible = (caller: Caller) =>
  sql`(d.visibility in ('public','unlisted') or d.created_by_actor_id=${caller.actorId} or exists(select 1 from round_participants p where p.round_id=d.id and p.actor_id=${caller.actorId} limit 1 offset 0))`;
const search = (q: string) =>
  sql`(${q}='' or strpos(lower(r.title),lower(${q}))>0 or strpos(lower(r.topic),lower(${q}))>0 or strpos(lower(${hostLabel}),lower(${q}))>0)`;
/** Bound candidates before locks; a race may shorten a page, never trigger replenishment. */
export async function discoverRooms(
  tx: Tx,
  caller: Caller,
  input: RoomListQuery,
  authorize: (fact: RoomDiscoveryFact, account: Account) => boolean,
  authorizeCollection: (account: Account) => boolean,
): Promise<RoomListPage> {
  const parsed = roomListQuerySchema.safeParse(input);
  if (!parsed.success) throw createAppError('VALIDATION');
  const { cursor, pageSize, q } = parsed.data;
  const after = cursor ?? '';
  let account = await lockedAccount(tx, caller);
  if (!authorizeCollection(account)) throw createAppError('AUTHORIZATION');
  const candidates = (await tx.execute(sql`
  select id from (
    (select r.id from rooms r ${joins}
      where r.status in ('assembling','ready') and r.id collate "C">${after} and ${visible(caller)} and ${search(q)}
      order by r.id collate "C" limit ${pageSize + 1})
    union all
    (select r.id from rounds d join rooms r on r.id=d.room_id ${joins}
      where d.status in ('scheduled','active') and d.room_id is not null and r.status='started'
        and d.room_id collate "C">${after} and ${visible(caller)} and ${roundVisible(caller)} and ${search(q)}
      order by d.room_id collate "C" limit ${pageSize + 1})
  ) candidates order by id collate "C" limit ${pageSize + 1}
 `)) as unknown as { id: string }[];
  const ids = candidates.slice(0, pageSize).map((r) => r.id);
  const more = candidates.length > pageSize;
  if (!ids.length) return { rooms: [], nextCursor: null, retry: false };
  const idSet = sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  await tx.execute(
    sql`select id from rooms where id=any(${idSet}) order by id for share`,
  );
  await tx.execute(
    sql`select id from rounds where room_id=any(${idSet}) order by id for share`,
  );
  // Producer facts are read again after every downstream lock wait.
  account = await loadAuthorizationAccount(tx, caller.userId);
  if (!authorizeCollection(account)) throw createAppError('AUTHORIZATION');
  const rows = (await tx.execute(sql`
  select r.id,r.version,r.title,r.topic,r.visibility,r.host_actor_id as "hostActorId",
   ${hostLabel} as "hostLabel",r.status,r.competition_type as "competitionType",r.length,
   p.actor_id is not null as seated,p.role,p.slot,
   case when r.status='started' then json_build_object('id',d.id,'status',d.status) else null end as "roundRef",
   d.version as "roundVersion",d.created_by_actor_id as "roundCreator",d.visibility as "roundVisibility",rp.role as "roundRole",rp.slot as "roundSlot"
  from rooms r ${joins}
  left join room_participants p on p.room_id=r.id and p.actor_id=${caller.actorId}
  left join rounds d on d.room_id=r.id
  left join round_participants rp on rp.round_id=d.id and rp.actor_id=${caller.actorId}
  where r.id=any(${idSet}) and ${visible(caller)} and ${search(q)}
   and (r.status in ('assembling','ready') or (r.status='started' and d.status in ('scheduled','active') and ${roundVisible(caller)}))
  order by r.id collate "C"
 `)) as unknown as (RoomListEntry & {
    role: string | null;
    slot: number | null;
    roundVersion: number;
    roundCreator: string | null;
    roundVisibility: RoomListEntry['visibility'];
    roundRole: string | null;
    roundSlot: number | null;
  })[];
  const entries = rows
    .filter((r) =>
      authorize(
        {
          ...r,
          participants: r.seated
            ? [{ actorId: caller.actorId, role: r.role!, slot: r.slot! }]
            : [],
          round: r.roundRef
            ? {
                kind: 'round',
                roundId: r.roundRef.id,
                status: r.roundRef.status,
                revision: r.roundVersion,
                createdByActorId: r.roundCreator,
                visibility: r.roundVisibility,
                participants: r.roundRole
                  ? [
                      {
                        actorId: caller.actorId,
                        role: r.roundRole,
                        slot: r.roundSlot!,
                      },
                    ]
                  : [],
              }
            : null,
        },
        account,
      ),
    )
    .map(
      ({
        role: _role,
        slot: _slot,
        roundVersion: _version,
        roundCreator: _creator,
        roundVisibility: _visibility,
        roundRole: _roundRole,
        roundSlot: _roundSlot,
        ...r
      }) => r,
    );
  return {
    rooms: entries,
    nextCursor: more ? (entries.at(-1)?.id ?? null) : null,
    retry: entries.length === 0 && candidates.length > 0,
  };
}
