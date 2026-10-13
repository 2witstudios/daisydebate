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

async function lockChannel(
  tx: AuthorizationTransaction,
  channelId: string,
  authority: MessagingChannelFact['authority'],
) {
  const pair = authority.kind === 'dm' ? authority : null;
  const rows = await tx.execute(sql`select public.daisy_messaging_channel_fence(
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

async function readChannelFact(tx: AuthorizationTransaction, input: Scope) {
  const fact = await readMessagingChannelFact(
    tx,
    input.channelId,
    input.actorId,
  );
  if (!fact) throw createAppError('NOT_FOUND');
  return fact;
}
/** Rereads the fact after the fences waited; a changed cast throws `changed()`. */
async function rereadSameCast(
  tx: AuthorizationTransaction,
  input: Scope,
  discovered: Awaited<ReturnType<typeof readChannelFact>>,
  changed: () => Error,
) {
  const fact = await readChannelFact(tx, input);
  if (
    JSON.stringify(actorIdsOf(discovered, input.actorId)) !==
    JSON.stringify(actorIdsOf(fact, input.actorId))
  )
    throw changed();
  return fact;
}
/** Authority only: canonical accounts -> pair -> id-only channel lock -> fresh cast/facts. */
export async function withLockedMessagingAuthority<T>(
  tx: AuthorizationTransaction,
  input: Scope,
  work: (frame: AuthorityFrame) => Promise<T>,
  extension?: {
    readonly additionalActors: readonly string[];
    readonly beforeChannel: (frame: AuthorityFrame) => Promise<void>;
  },
): Promise<T> {
  const additional = extension?.additionalActors ?? [];
  validateScope(input, additional);
  const discovered = await readChannelFact(tx, input);
  const actors = actorIdsOf(discovered, input.actorId, additional);
  const accounts = await lockAuthorizationActors(tx, actors, {
    maxActors: 65535,
  });
  if (extension)
    await extension.beforeChannel({ tx, fact: discovered, accounts });
  if (!(await lockChannel(tx, input.channelId, discovered.authority)))
    throw createAppError('NOT_FOUND');
  const fact = await rereadSameCast(tx, input, discovered, () =>
    createAppError('CONFLICT'),
  );
  return work({ tx, fact, accounts });
}
/** Public database factory binds its pool; the consumer evaluates policy in this same tx. */
export function createMessagingChannelAuthority(database: BunSQLDatabase) {
  return <T>(
    input: Scope,
    work: (frame: AuthorityFrame) => Promise<T>,
  ): Promise<T> =>
    database.transaction((tx) => withLockedMessagingAuthority(tx, input, work));
}

/** The cast moved while a shared fence waited; the caller restarts the whole transaction. */
export class MessagingCastChanged extends Error {}
/**
 * Readers: SHARE-fence the current cast's accounts, then the DM pair and channel
 * (canonical order), reread the fact after the waits and restart on any cast change.
 * Compatible readers never block each other; exclusive authority writers still do.
 */
export async function withSharedMessagingAuthority<T>(
  tx: AuthorizationTransaction,
  input: Scope,
  work: (frame: AuthorityFrame) => Promise<T>,
): Promise<T> {
  validateScope(input, []);
  const discovered = await readChannelFact(tx, input);
  const accounts = await readAuthorizationActors(
    tx,
    actorIdsOf(discovered, input.actorId),
    { maxActors: 65535 },
  );
  const pair = discovered.authority.kind === 'dm' ? discovered.authority : null;
  const fenced = await tx.execute(
    sql`select resource_id as id from public.daisy_observation_authority_fences(${JSON.stringify([{ kind: 'channel', id: input.channelId }])}::text::jsonb,${JSON.stringify(pair ? [{ low: pair.lowActorId, high: pair.highActorId }] : [])}::text::jsonb)`,
  );
  if (fenced[0]?.id !== input.channelId) throw createAppError('NOT_FOUND');
  const fact = await rereadSameCast(
    tx,
    input,
    discovered,
    () => new MessagingCastChanged(),
  );
  return work({ tx, fact, accounts });
}
