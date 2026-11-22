import { addMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { isRoundOver } from '@daisy/protocol/round';
import { isDebatingSeatSql } from '../seat-columns';
import {
  roundFloorRetentionMs,
  type RoundFloorFact,
} from '@daisy/protocol/round-floor';
import { sql } from 'drizzle-orm';
import type { ContextChannelOwner } from './context-channel-contracts';
import { createContextChannelStore } from './context-channel-store';
import {
  fenceRoundFloor,
  readRoundFloorFact,
  type FloorYouth,
} from './round-floor-facts';
import type {
  RoundFloorFence,
  RoundFloorScope,
  RoundFloorReadFrame,
  RoundFloorWriteFrame,
} from './round-floor-contracts';
import type { TxSource } from '../tx';
import { query } from '../raw-rows';
import { z } from 'zod';

type DiscoveryScope = Omit<RoundFloorScope, 'channelId'>;
export const roundFloorMetadataOf = (fact: RoundFloorFact) => {
  if (!fact.channelId)
    throw createAppError('INVARIANT', 'Messaging channel is missing');
  return {
    channelId: fact.channelId,
    // A linked adult watches and never posts (ADR 0155).
    readOnly: isRoundOver(fact.status) || fact.audience === 'linked_adult',
    expiresAt:
      fact.completedAt === null
        ? null
        : addMs(fact.completedAt, roundFloorRetentionMs),
  };
};

/**
 * The floor as a context channel: the Round's lock, its fact and its named
 * audience, a Youth Round's linked adults included.
 */
const roundFloorOwner = (
  youth: FloorYouth,
): ContextChannelOwner<RoundFloorFact> => ({
  kind: 'round_floor',
  fence: fenceRoundFloor,
  readFact: (tx, ownerId, actorId) =>
    readRoundFloorFact(tx, ownerId, actorId, youth),
  insertChannel: async (tx, { ownerId, channelId }) => {
    const [created] = await query(
      tx,
      z.object({ id: z.string() }),
      sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,round_id) values(${channelId},'round_floor','round.floor',1,'active',${ownerId}) on conflict (round_id,kind) do nothing returning id`,
    );
    return created !== undefined;
  },
  /** Only the frozen debaters and the named host are ever labelled. */
  readAuthors: async (tx, { ownerId, channelId }) => {
    const rows = await query(
      tx,
      z.object({ actorId: z.string(), label: z.string() }),
      sql`select distinct a.id as "actorId",u.username as label from messaging_messages m join actors a on a.id=m.author_actor_id and a.kind='human' join users u on u.id=a.user_id and u.deleted_at is null join rounds r on r.id=${ownerId} left join round_participants p on p.round_id=r.id and p.actor_id=a.id where m.channel_id=${channelId} and m.text is not null and m.removed_at is null and (${isDebatingSeatSql(sql`p.seat_kind`)} or (p.seat_kind is null and r.created_by_actor_id=a.id)) order by a.id`,
    );
    return rows;
  },
  metadataOf: roundFloorMetadataOf,
});

/**
 * A named contextual producer: social pair/grant loaders never admit its
 * channel. `youth` is the Round's linked adults, read by the boundary through
 * its cache (ADR 0155); null on any other Round.
 */
export function createRoundFloorStore(
  database: TxSource,
  authorize: RoundFloorFence,
  youth: FloorYouth = null,
) {
  const store = createContextChannelStore(
    database,
    roundFloorOwner(youth),
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
