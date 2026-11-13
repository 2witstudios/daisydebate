import { isRoundOver } from '@daisy/protocol';
import {
  roundFloorRetentionMs,
  type RoundFloorFact,
} from '@daisy/protocol/round-floor';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { ContextChannelOwner } from './context-channel-contracts';
import { createContextChannelStore } from './context-channel-store';
import { fenceRoundFloor, readRoundFloorFact } from './round-floor-facts';
import type {
  RoundFloorFence,
  RoundFloorScope,
  RoundFloorReadFrame,
  RoundFloorWriteFrame,
} from './round-floor-contracts';

type DiscoveryScope = Omit<RoundFloorScope, 'channelId'>;
export const roundFloorMetadataOf = (fact: RoundFloorFact) => ({
  channelId: fact.channelId!,
  readOnly: isRoundOver(fact.status),
  expiresAt:
    fact.completedAt === null
      ? null
      : new Date(
          Date.parse(fact.completedAt) + roundFloorRetentionMs,
        ).toISOString(),
});

/** The floor as a context channel: the Round's lock, its fact and its named audience. */
const roundFloorOwner: ContextChannelOwner<RoundFloorFact> = {
  kind: 'round_floor',
  fence: fenceRoundFloor,
  readFact: readRoundFloorFact,
  insertChannel: async (tx, { ownerId, channelId }) => {
    const [created] = await tx.execute(
      sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,round_id) values(${channelId},'round_floor','round.floor',1,'active',${ownerId}) on conflict (round_id,kind) do nothing returning id`,
    );
    return created !== undefined;
  },
  /** Only the frozen debaters and the named host are ever labelled. */
  readAuthors: async (tx, { ownerId, channelId }) => {
    const rows = await tx.execute(
      sql`select distinct a.id as "actorId",u.username as label from messaging_messages m join actors a on a.id=m.author_actor_id and a.kind='human' join users u on u.id=a.user_id and u.deleted_at is null join rounds r on r.id=${ownerId} left join round_participants p on p.round_id=r.id and p.actor_id=a.id where m.channel_id=${channelId} and m.text is not null and m.removed_at is null and (p.role in ('affirmative','negative') or (p.role is null and r.created_by_actor_id=a.id)) order by a.id`,
    );
    return rows as unknown as readonly {
      readonly actorId: string;
      readonly label: string;
    }[];
  },
  metadataOf: roundFloorMetadataOf,
};

/** A named contextual producer: social pair/grant loaders never admit its channel. */
export function createRoundFloorStore(
  database: BunSQLDatabase,
  authorize: RoundFloorFence,
) {
  const store = createContextChannelStore(
    database,
    roundFloorOwner,
    ({ scope: { ownerId, ...caller }, ...authority }) =>
      authorize({ ...authority, scope: { roundId: ownerId, ...caller } }),
  );
  const owned = <Scope extends { readonly roundId: string }>({
    roundId,
    ...scope
  }: Scope) => ({ ownerId: roundId, ...scope });
  return {
    discover: (scope: DiscoveryScope) => store.discover(owned(scope)),
    open: (scope: DiscoveryScope & { readonly newChannelId: string }) =>
      store.open(owned(scope)),
    readFloor: <T>(
      scope: RoundFloorScope & { readonly action?: 'remove' },
      work: (frame: RoundFloorReadFrame) => Promise<T>,
    ) => store.readChannel(owned(scope), work),
    withFloor: <T>(
      scope: RoundFloorScope & { readonly action?: 'post' | 'remove' },
      work: (frame: RoundFloorWriteFrame) => Promise<T>,
    ) => store.withChannel(owned(scope), work),
  };
}
