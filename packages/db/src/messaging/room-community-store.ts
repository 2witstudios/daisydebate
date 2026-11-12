import { isOpenRoomStatus } from '@daisy/protocol';
import {
  roomCommunityRetentionMs,
  type RoomCommunityFact,
} from '@daisy/protocol/room-community';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { ContextChannelOwner } from './context-channel-contracts';
import { createContextChannelStore } from './context-channel-store';
import {
  fenceRoomCommunity,
  readRoomCommunityFact,
} from './room-community-facts';
import type {
  RoomCommunityFence,
  RoomCommunityReadFrame,
  RoomCommunityScope,
  RoomCommunityWriteFrame,
} from './room-community-contracts';

type DiscoveryScope = Omit<RoomCommunityScope, 'channelId'>;
/** Read-only and expiring only once the Room has ended, when own removal is all that is left. */
export const roomCommunityMetadataOf = (fact: RoomCommunityFact) => ({
  channelId: fact.channelId!,
  readOnly: !isOpenRoomStatus(fact.status),
  expiresAt:
    fact.endedAt === null
      ? null
      : new Date(
          Date.parse(fact.endedAt) + roomCommunityRetentionMs,
        ).toISOString(),
});
/** The most authors one page may label: the page's own and the newest messages'. */
const AUTHOR_LABELS = 100;

/** Room chat as a context channel: the Room's lock, its fact and its authors. */
const roomCommunityOwner: ContextChannelOwner<RoomCommunityFact> = {
  kind: 'room_community',
  fence: fenceRoomCommunity,
  readFact: readRoomCommunityFact,
  insertChannel: async (tx, { ownerId, channelId }) => {
    const [created] = await tx.execute(
      sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,room_id) values(${channelId},'room_community','room.community',1,'active',${ownerId}) on conflict (room_id,kind) do nothing returning id`,
    );
    return created !== undefined;
  },
  /**
   * Usernames only, never a seat or a standing: the page's authors first, then
   * the authors of the newest messages, so a live message has its label.
   */
  readAuthors: async (tx, { channelId, authorActorIds }) => {
    const requested = sql`array[${sql.join(
      authorActorIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]`;
    const wanted = authorActorIds.length ? requested : sql`array[]::text[]`;
    const rows = await tx.execute(
      sql`select a.id as "actorId",u.username as label from actors a join users u on u.id=a.user_id and u.deleted_at is null
        where a.kind='human' and a.id in (
          select recent.author_actor_id from (select m.author_actor_id from messaging_messages m where m.channel_id=${channelId} and m.text is not null and m.removed_at is null order by m.sequence desc limit ${AUTHOR_LABELS}) recent
          union
          select m.author_actor_id from messaging_messages m where m.channel_id=${channelId} and m.text is not null and m.removed_at is null and m.author_actor_id=any(${wanted})
        ) order by (a.id=any(${wanted})) desc,a.id limit ${AUTHOR_LABELS}`,
    );
    return rows as unknown as readonly {
      readonly actorId: string;
      readonly label: string;
    }[];
  },
  metadataOf: roomCommunityMetadataOf,
};

/** A named contextual producer: social pair/grant loaders never admit its channel. */
export function createRoomCommunityStore(
  database: BunSQLDatabase,
  authorize: RoomCommunityFence,
) {
  const store = createContextChannelStore(
    database,
    roomCommunityOwner,
    ({ scope: { ownerId, ...caller }, ...authority }) =>
      authorize({ ...authority, scope: { roomId: ownerId, ...caller } }),
  );
  const owned = <Scope extends { readonly roomId: string }>({
    roomId,
    ...scope
  }: Scope) => ({ ownerId: roomId, ...scope });
  return {
    discover: (scope: DiscoveryScope) => store.discover(owned(scope)),
    open: (scope: DiscoveryScope & { readonly newChannelId: string }) =>
      store.open(owned(scope)),
    readChat: <T>(
      scope: RoomCommunityScope & { readonly action?: 'remove' },
      work: (frame: RoomCommunityReadFrame) => Promise<T>,
    ) => store.readChannel(owned(scope), work),
    withChat: <T>(
      scope: RoomCommunityScope & { readonly action?: 'post' | 'remove' },
      work: (frame: RoomCommunityWriteFrame) => Promise<T>,
    ) => store.withChannel(owned(scope), work),
  };
}
