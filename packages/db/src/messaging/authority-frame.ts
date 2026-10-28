import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  lockAuthorizationActors,
  readAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import { readMessagingChannelFact, type MessagingChannelFact } from './social';
type Scope = {
  readonly channelId: string;
  readonly actorId: string;
  readonly userId: string;
};
type AuthorityFrame = {
  readonly tx: AuthorizationTransaction;
  readonly fact: MessagingChannelFact;
  readonly accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>;
};
const actorIdsOf = (
  fact: MessagingChannelFact,
  actorId: string,
  additionalActors: readonly string[] = [],
) =>
  [
    ...new Set([
      actorId,
      ...additionalActors,
      ...(fact.authority.kind === 'dm'
        ? [fact.authority.lowActorId, fact.authority.highActorId]
        : fact.authority.activeMemberActorIds),
    ]),
  ].sort();

const castChanges = new WeakSet<Error>();
/**
 * The channel's cast moved between discovery and the fences; a read restarts.
 * Recognised through up to 8 native `cause` links, so a layer that wraps the
 * signal (a driver transaction, an `AppError` with `cause`) still restarts.
 */
const isCastChange = (error: unknown) => {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (castChanges.has(current)) return true;
    current = Object.getOwnPropertyDescriptor(current, 'cause')?.value;
  }
  return false;
};
/** A writer sees it as a plain CONFLICT; a read restarts on it. */
export function castChanged() {
  const error = createAppError('CONFLICT');
  castChanges.add(error);
  return error;
}
/** Writers fence exclusively; readers share, so peer readers never wait on each other. */
type FenceMode = 'exclusive' | 'shared';
const fences = {
  exclusive: {
    accounts: lockAuthorizationActors,
    channel: sql`public.daisy_messaging_channel_fence`,
  },
  shared: {
    accounts: readAuthorizationActors,
    channel: sql`public.daisy_messaging_channel_read_fence`,
  },
} as const;

async function lockChannel(
  tx: AuthorizationTransaction,
  channelId: string,
  authority: MessagingChannelFact['authority'],
  mode: FenceMode,
) {
  const pair = authority.kind === 'dm' ? authority : null;
  const rows = await tx.execute(sql`select ${fences[mode].channel}(
    ${channelId}::text, ${pair?.lowActorId ?? null}::text, ${pair?.highActorId ?? null}::text
  ) as locked`);
  return rows[0]?.locked === true;
}

function validateScope(input: Scope, additional: readonly string[]) {
  for (const id of [
    input.channelId,
    input.actorId,
    input.userId,
    ...additional,
  ])
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
}

type Extension = {
  readonly additionalActors: readonly string[];
  readonly beforeChannel: (frame: AuthorityFrame) => Promise<void>;
};
/** Authority only: canonical accounts -> pair -> id-only channel lock -> fresh cast/facts. */
export const withLockedMessagingAuthority = <T>(
  tx: AuthorizationTransaction,
  input: Scope,
  work: (frame: AuthorityFrame) => Promise<T>,
  extension?: Extension,
): Promise<T> => fencedAuthority(tx, input, work, 'exclusive', extension);
/**
 * The same authority under shared fences, for reads (MSG-2.1-arch1): same
 * lock order, so a reader never inverts a writer's graph. A cast that moved
 * between discovery and the fences is CONFLICT; the owning transaction
 * restarts the whole read.
 */
export const withSharedMessagingAuthority = <T>(
  tx: AuthorizationTransaction,
  input: Scope,
  work: (frame: AuthorityFrame) => Promise<T>,
  extension?: Extension,
): Promise<T> => fencedAuthority(tx, input, work, 'shared', extension);

async function fencedAuthority<T>(
  tx: AuthorizationTransaction,
  input: Scope,
  work: (frame: AuthorityFrame) => Promise<T>,
  mode: FenceMode,
  extension?: Extension,
): Promise<T> {
  const additional = extension?.additionalActors ?? [];
  validateScope(input, additional);
  const discovered = await readMessagingChannelFact(
    tx,
    input.channelId,
    input.actorId,
  );
  if (!discovered) throw createAppError('NOT_FOUND');
  const actors = actorIdsOf(discovered, input.actorId, additional);
  const accounts = await fences[mode].accounts(tx, actors, {
    maxActors: 65535,
  });
  if (extension)
    await extension.beforeChannel({ tx, fact: discovered, accounts });
  if (!(await lockChannel(tx, input.channelId, discovered.authority, mode)))
    throw createAppError('NOT_FOUND');
  const fact = await readMessagingChannelFact(
    tx,
    input.channelId,
    input.actorId,
  );
  if (!fact) throw createAppError('NOT_FOUND');
  if (
    JSON.stringify(actorIdsOf(discovered, input.actorId)) !==
    JSON.stringify(actorIdsOf(fact, input.actorId))
  )
    throw castChanged();
  return work({ tx, fact, accounts });
}
/** Whole-transaction restarts a read takes when the cast keeps moving. */
const READ_RESTARTS = 2;
/**
 * Runs a read transaction, restarting it whole at most twice when the cast
 * moved under it; still moving after that is a retryable outage, never a
 * stale answer (MSG-2.1-arch1).
 */
export async function restartingRead<T>(
  database: Pick<BunSQLDatabase, 'transaction'>,
  read: (
    tx: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.transaction(read);
    } catch (error) {
      if (!isCastChange(error)) throw error;
      if (attempt >= READ_RESTARTS)
        throw createAppError('INFRASTRUCTURE', undefined, error);
    }
  }
}
/**
 * Public database factory binds its pool; the consumer evaluates policy in
 * this same tx. Its consumers (inbox entries, realtime subscribe decisions)
 * only read, so it takes the shared fences.
 */
export function createMessagingChannelAuthority(database: BunSQLDatabase) {
  return <T>(
    input: Scope,
    work: (frame: AuthorityFrame) => Promise<T>,
  ): Promise<T> =>
    restartingRead(database, (tx) =>
      withSharedMessagingAuthority(tx, input, work),
    );
}

/**
 * One shared-fenced read for many viewers of one channel (ADR 0089): the
 * full cast and every viewer's account are fenced and read once, in the
 * canonical order, and each distinct viewer's own channel fact is read
 * inside that same snapshot. Renewing 500 viewers costs one cohort read,
 * not 500 authority transactions: its statements are constant in viewers
 * (one grant read for a group, none for a DM) apart from one age read per
 * distinct account.
 */
export function createMessagingChannelCohortAuthority(
  database: BunSQLDatabase,
) {
  return <T>(
    input: {
      readonly channelId: string;
      readonly viewers: readonly {
        readonly actorId: string;
        readonly userId: string;
      }[];
    },
    work: (frame: {
      readonly tx: AuthorizationTransaction;
      readonly accounts: AuthorityFrame['accounts'];
      readonly factFor: (actorId: string) => MessagingChannelFact;
    }) => Promise<T>,
  ): Promise<T> => {
    const [first, ...rest] = input.viewers;
    if (!first || input.viewers.length > 65535)
      throw createAppError('VALIDATION');
    const others = [...new Set(rest.map((viewer) => viewer.actorId))].filter(
      (actorId) => actorId !== first.actorId,
    );
    return restartingRead(database, (tx) =>
      withSharedMessagingAuthority(
        tx,
        { channelId: input.channelId, ...first },
        async ({ fact, accounts }) => {
          const facts = await viewerFacts(tx, fact, [first.actorId, ...others]);
          return work({
            tx,
            accounts,
            factFor: (actorId) => {
              const own = facts.get(actorId);
              if (!own) throw createAppError('INVARIANT');
              return own;
            },
          });
        },
        { additionalActors: others, beforeChannel: async () => {} },
      ),
    );
  };
}

/**
 * Every viewer's own channel fact, set-based: a DM's fact does not depend on
 * the reader; a group's differs only in the reader's own grant, read for
 * every viewer in one statement under the fences already held. The same
 * derivation as `readMessagingChannelFact`'s group branch.
 */
async function viewerFacts(
  tx: AuthorizationTransaction,
  fact: MessagingChannelFact,
  actorIds: readonly string[],
): Promise<ReadonlyMap<string, MessagingChannelFact>> {
  const { authority } = fact;
  if (authority.kind === 'dm')
    return new Map(actorIds.map((actorId) => [actorId, fact]));
  const rows = (await tx.execute(sql`
    select actor_id as "actorId", role, revoked_at as "revokedAt", generation
    from messaging_group_grants
    where channel_id = ${fact.channelId} and actor_id = any(array[${sql.join(
      actorIds.map((actorId) => sql`${actorId}`),
      sql`, `,
    )}]::text[])
  `)) as unknown as {
    actorId: string;
    role: 'manager' | 'member';
    revokedAt: unknown;
    generation: number;
  }[];
  const grants = new Map(rows.map((row) => [row.actorId, row]));
  return new Map(
    actorIds.map((actorId): [string, MessagingChannelFact] => {
      const grant = grants.get(actorId);
      return [
        actorId,
        {
          ...fact,
          authority: {
            ...authority,
            actorId,
            role: grant && grant.revokedAt === null ? grant.role : null,
            generation: Number(grant?.generation ?? 0),
          },
        } as MessagingChannelFact,
      ];
    }),
  );
}
