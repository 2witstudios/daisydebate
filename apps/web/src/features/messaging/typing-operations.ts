import type { Database } from '@daisy/db';
import type { createRedis } from '@daisy/redis';
import type { Clock } from '@daisy/clock';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { messagingTypingSchemas } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import { requireMessagingActor } from './principal';
import { requireMessagingAuthorization } from './authorization';
import {
  typingAuthority,
  typingAggregate,
  typingProjectionChanged,
} from './typing-authority';
import type { MessagingRuntimePolicy } from './composition';
/** All Redis/vendor awaits remain within the actual SQL authority fence; no lease grants authority. */
export function composeMessagingTyping({
  database,
  redis,
  clock,
  policy,
  principal,
  bounds,
  readAccounts,
}: {
  readonly database: Pick<Database, 'messagingTypingStore'>;
  readonly redis: Pick<
    ReturnType<typeof createRedis>,
    'readTypingLeases' | 'writeTypingLease' | 'clearTypingLease'
  >;
  readonly clock: Clock;
  readonly policy: MessagingRuntimePolicy;
  readonly principal: AuthorizationPrincipal;
  readonly bounds: ReturnType<typeof messagingTypingSchemas.policy.parse>;
  readonly readAccounts: typeof loadAccountPolicyFacts;
}) {
  const actor = requireMessagingActor(principal);
  const run = (channelId: string, typing: boolean | undefined) =>
    database.messagingTypingStore(
      { ...actor, channelId },
      bounds.maxActors,
      async (frame) => {
        return runTypingFrame({
          actor,
          principal,
          channelId,
          typing,
          bounds,
          refreshAuthority: async () => {
            const accounts = await readAccounts(
              frame.tx,
              frame.accounts,
              clock.now(),
            );
            const now = clock.now();
            return {
              now,
              authority: typingAuthority({
                channels: frame.channels,
                accounts,
                policy,
                now,
              }),
            };
          },
          read: () =>
            redis.readTypingLeases(
              channelId,
              frame.channels.map((row) => row.actorId),
              bounds.maxActors,
            ),
          write: (lease, ttlMs) => redis.writeTypingLease(lease, ttlMs),
          clear: () => redis.clearTypingLease(channelId, actor.actorId),
          notify: frame.notify,
        });
      },
    );
  return {
    read: (channelId: string) => run(channelId, undefined),
    update: (channelId: string, typing: boolean) => run(channelId, typing),
  };
}

/** Actual vendor-port operation; every await is followed by a fresh canonical snapshot before projection/publish. */
export async function runTypingFrame({
  actor,
  principal,
  channelId,
  typing,
  bounds,
  refreshAuthority,
  read,
  write,
  clear,
  notify,
}: {
  readonly actor: ReturnType<typeof requireMessagingActor>;
  readonly principal: AuthorizationPrincipal;
  readonly channelId: string;
  readonly typing: boolean | undefined;
  readonly bounds: ReturnType<typeof messagingTypingSchemas.policy.parse>;
  readonly refreshAuthority: () => Promise<{
    readonly now: string;
    readonly authority: ReturnType<typeof typingAuthority>;
  }>;
  readonly read: () => Promise<
    readonly ReturnType<typeof messagingTypingSchemas.lease.parse>[]
  >;
  readonly write: (
    lease: ReturnType<typeof messagingTypingSchemas.lease.parse>,
    ttlMs: number,
  ) => Promise<void>;
  readonly clear: () => Promise<void>;
  readonly notify: () => Promise<void>;
}) {
  const snapshot = async () => {
    const current = await refreshAuthority();
    const own = current.authority.find((row) => row.actorId === actor.actorId);
    if (!own) throw createAppError('NOT_FOUND');
    requireMessagingAuthorization({
      ...own.input,
      capability: typing === undefined ? 'channel.read' : 'channel.post',
      principal,
    });
    requireMessagingAuthorization({
      ...own.input,
      capability: 'channel.read',
      principal,
    });
    return { ...current, own };
  };
  await snapshot();
  const before = await read();
  if (typing !== undefined) {
    const current = await snapshot();
    if (typing) {
      if (!current.own.lease) throw createAppError('AUTHORIZATION');
      const expiresAt = Math.min(
        Date.parse(current.own.lease.expiresAt),
        Date.parse(current.now) + bounds.ttlMs,
      );
      const ttlMs = expiresAt - Date.parse(current.now);
      if (ttlMs <= 0) throw createAppError('AUTHORIZATION');
      await write(
        { ...current.own.lease, expiresAt: new Date(expiresAt).toISOString() },
        ttlMs,
      );
    } else await clear();
  }
  const after = typing === undefined ? before : await read();
  const final = await snapshot();
  if (
    typing !== undefined &&
    typingProjectionChanged(final.authority, before, after, final.now)
  )
    await notify();
  const aggregate = typingAggregate(
    final.authority,
    after,
    actor.actorId,
    final.now,
  );
  return messagingTypingSchemas.result.parse({
    version: 1,
    channelId,
    typing: aggregate.typing,
    refreshAfterMs:
      aggregate.expiresAt === null
        ? bounds.refetchMs
        : Math.min(
            bounds.refetchMs,
            Math.max(1, aggregate.expiresAt - Date.parse(final.now)),
          ),
  });
}
