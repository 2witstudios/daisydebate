import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { readAuthorizationActors } from '../authorization';
import type { ContextChannelFact } from './context-channel-contracts';
import { channelObservationReads } from './observation-reads';
import { inTransaction, type Tx, type TxSource } from '../tx';

/** What one context supplies so realtime can decide a cohort of viewers of its channel. */
export type ContextChannelObservationOwner<Fact extends ContextChannelFact> = {
  /** The owner of this context's channel, or null when the channel is not this context's. */
  readonly ownerOf: (tx: Tx, channelId: string) => Promise<string | null>;
  readonly fence: (tx: Tx, ownerId: string) => Promise<boolean>;
  readonly fenceChannel: (tx: Tx, channelId: string) => Promise<boolean>;
  /** One cohort statement: only the requested callers' facts cross the boundary. */
  readonly readFacts: (
    tx: Tx,
    ownerId: string,
    actorIds: readonly string[],
  ) => Promise<ReadonlyMap<string, Fact>>;
};

/** A context's adoption of the existing channel-messages observation resource. */
export function createContextChannelCohortAuthority<
  Fact extends ContextChannelFact,
>(database: TxSource, owner: ContextChannelObservationOwner<Fact>) {
  return async <T>(
    input: {
      readonly channelId: string;
      readonly viewers: readonly {
        readonly actorId: string;
        readonly userId: string;
      }[];
    },
    work: (frame: {
      readonly tx: Tx;
      readonly accounts: Awaited<ReturnType<typeof readAuthorizationActors>>;
      readonly factFor: (actorId: string) => Fact;
      readonly contentRevision: number;
    }) => Promise<T>,
  ): Promise<T> => {
    idSchema.parse(input.channelId);
    const actorIds = [
      ...new Set(input.viewers.map((v) => idSchema.parse(v.actorId))),
    ].sort();
    if (actorIds.length === 0 || input.viewers.length > 65535)
      throw createAppError('VALIDATION');
    return inTransaction(database, async (tx) => {
      const accounts = await readAuthorizationActors(tx, actorIds, {
        maxActors: 65535,
      });
      const ownerId = await owner.ownerOf(tx, input.channelId);
      if (ownerId === null || !(await owner.fence(tx, ownerId)))
        throw createAppError('NOT_FOUND');
      if (!(await owner.fenceChannel(tx, input.channelId)))
        throw createAppError('NOT_FOUND');
      const facts = await owner.readFacts(tx, ownerId, actorIds);
      if (
        actorIds.some(
          (actorId) => facts.get(actorId)?.channelId !== input.channelId,
        )
      )
        throw createAppError('NOT_FOUND');
      const header = (
        await channelObservationReads(tx).readChannelObservationHeaders([
          input.channelId,
        ])
      ).get(input.channelId);
      if (!header) throw createAppError('NOT_FOUND');
      return work({
        tx,
        accounts,
        contentRevision: header.contentRevision,
        factFor: (actorId) => {
          const fact = facts.get(actorId);
          if (!fact) throw createAppError('INVARIANT');
          return fact;
        },
      });
    });
  };
}
