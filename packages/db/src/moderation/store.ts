import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import type { ModerationNotice } from '@daisy/protocol';
import {
  moderationLiftCommandAction,
  type ModerationLiftResult,
} from '@daisy/protocol/operator';
import {
  lockAuthorizationActors,
  readOwnCollection,
  requireOwnScope,
  type OwnCollectionFence,
} from '../authorization';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import {
  commandGate,
  storedResult,
  writeReceipt,
  type OperatorCommandTransaction as Transaction,
} from '../operator-command';
import { moderationActions } from '../schema/moderation';
import { appendSessionRevokedFor } from '../session-revoked';
import { actionInForce } from './in-force';

/** What a reviewer does to an account (ADR 0103). */
export type Sanction =
  | { readonly kind: 'warning' }
  | { readonly kind: 'suspension'; readonly endsAt: string }
  | { readonly kind: 'ban' };

/**
 * What another concept registers at the composition root to react when a
 * suspension or ban begins, inside the same transaction, so Moderation never
 * names a consumer's table.
 */
export type ModerationReactions = {
  readonly onRestricted: readonly ((
    tx: Transaction,
    actorId: string,
    context: {
      readonly now: string;
      readonly nextId: () => string;
      readonly eventSink: DatabaseEventSink | undefined;
    },
  ) => Promise<void>)[];
};

/**
 * Moderation's one named write: records a sanction on a locked account and
 * moves its revision, so live sockets re-check it. A suspension or ban also
 * revokes the sessions and runs each reaction.
 */
export async function applySanction(
  tx: Transaction,
  input: {
    readonly id: string;
    readonly userId: string;
    readonly actorId: string;
    readonly sanction: Sanction;
    readonly operatorRef: string;
    readonly now: string;
    readonly nextId: () => string;
  },
  dependencies: {
    readonly eventSink: DatabaseEventSink | undefined;
    readonly reactions: ModerationReactions;
  },
): Promise<void> {
  await tx.insert(moderationActions).values({
    id: input.id,
    userId: input.userId,
    kind: input.sanction.kind,
    startsAt: new Date(input.now),
    operatorRef: input.operatorRef,
    ...(input.sanction.kind === 'suspension'
      ? { endsAt: new Date(input.sanction.endsAt) }
      : {}),
  });
  await tx.execute(
    sql`update users set version = version + 1 where id = ${input.userId}`,
  );
  if (input.sanction.kind === 'warning') return;
  await appendSessionRevokedFor(
    tx,
    input.userId,
    dependencies.eventSink,
    'applySanction',
  );
  for (const react of dependencies.reactions.onRestricted)
    await react(tx, input.actorId, {
      now: input.now,
      nextId: input.nextId,
      eventSink: dependencies.eventSink,
    });
}

export type OperatorRestrictionRow = {
  readonly id: string;
  readonly userId: string;
  readonly username: string | null;
  readonly kind: 'suspension' | 'ban';
  readonly startsAt: string;
  readonly endsAt: string | null;
};

export type ModerationLiftInput = {
  readonly commandId: string;
  readonly actionId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly now: string;
  readonly live: () => boolean;
};

const iso = (value: Date | string) => new Date(value).toISOString();

const mActionInForce = (at: Date) =>
  sql`public.daisy_moderation_action_in_force(m.kind, m.starts_at, m.ends_at, m.lifted_at, ${at}::timestamptz)`;

/** Lifts a suspension or ban in force; the row stays for the record. */
async function liftModeration(
  tx: Transaction,
  input: ModerationLiftInput,
): Promise<ModerationLiftResult> {
  await commandGate(tx, input.commandId);
  const replayed = await storedResult(tx, input.commandId, input.requestDigest);
  if (replayed) return replayed as ModerationLiftResult;
  const [row] =
    (await tx.execute(sql`select m.user_id as "userId", a.id as "actorId"
    from moderation_actions m join actors a on a.user_id = m.user_id and a.kind = 'human'
    where m.id = ${input.actionId}`)) as unknown as {
      userId: string;
      actorId: string;
    }[];
  if (!row) throw createAppError('NOT_FOUND');
  await lockAuthorizationActors(tx, [row.actorId], { maxActors: 1 });
  const lifted = await tx
    .update(moderationActions)
    .set({ liftedAt: new Date(input.now) })
    .where(
      and(
        eq(moderationActions.id, input.actionId),
        actionInForce(new Date(input.now)),
      ),
    )
    .returning({ id: moderationActions.id });
  if (!lifted[0]) throw createAppError('CONFLICT');
  await tx.execute(
    sql`update users set version = version + 1 where id = ${row.userId}`,
  );
  const result: ModerationLiftResult = {
    commandId: input.commandId,
    actionId: input.actionId,
  };
  await writeReceipt(tx, input, row.userId, {
    action: moderationLiftCommandAction,
    result,
  });
  if (!input.live()) throw createAppError('CONFLICT');
  return result;
}

type Scope = { readonly userId: string; readonly actorId: string };

/** Moderation's operations (ADR 0103), instrumented. */
export const moderationOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** One keyset page of suspensions and bans in force, newest first. */
  listOperatorRestrictions: (input: {
    readonly now: string;
    readonly limit: number;
    readonly after: { readonly startsAt: string; readonly id: string } | null;
  }): Promise<readonly OperatorRestrictionRow[]> =>
    instrumented(eventSink, 'listOperatorRestrictions', async () => {
      const rows = (await database.execute(sql`
        select m.id, m.user_id as "userId", u.username, m.kind,
          m.starts_at as "startsAt", m.ends_at as "endsAt"
        from moderation_actions m join users u on u.id = m.user_id
        where ${mActionInForce(new Date(input.now))}
          ${
            input.after
              ? sql`and (m.starts_at, m.id) < (${input.after.startsAt}::timestamptz, ${input.after.id})`
              : sql``
          }
        order by m.starts_at desc, m.id desc
        limit ${input.limit}`)) as unknown as (Omit<
        OperatorRestrictionRow,
        'startsAt' | 'endsAt'
      > & { startsAt: Date | string; endsAt: Date | string | null })[];
      return rows.map((row) => ({
        ...row,
        startsAt: iso(row.startsAt),
        endsAt: row.endsAt === null ? null : iso(row.endsAt),
      }));
    }),
  liftModeration: (input: ModerationLiftInput) =>
    instrumented(eventSink, 'liftModeration', () =>
      database.transaction((tx) => liftModeration(tx, input)),
    ),
  /** When the account's restriction in force ends; null for a ban or nothing. */
  readRestrictionEnd: (input: {
    readonly userId: string;
    readonly now: string;
  }): Promise<string | null> =>
    instrumented(eventSink, 'readRestrictionEnd', async () => {
      const [row] = (await database.execute(sql`
        select case when bool_or(m.kind = 'ban') then null else max(m.ends_at) end as "endsAt"
        from moderation_actions m
        where m.user_id = ${input.userId} and ${mActionInForce(new Date(input.now))}`)) as unknown as {
        endsAt: Date | string | null;
      }[];
      return row?.endsAt ? iso(row.endsAt) : null;
    }),
  /** The member's own warnings they have not acknowledged. */
  listModerationNotices: (
    scope: Scope,
    authorize: OwnCollectionFence<Scope>,
  ): Promise<readonly ModerationNotice[]> => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'listModerationNotices', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        const rows = (await tx.execute(sql`
          select id, kind, starts_at as "startsAt" from moderation_actions
          where user_id = ${scope.userId} and kind = 'warning' and acknowledged_at is null
          order by starts_at desc limit 5`)) as unknown as {
          id: string;
          kind: ModerationNotice['kind'];
          startsAt: Date | string;
        }[];
        return rows.map((row) => ({ ...row, startsAt: iso(row.startsAt) }));
      }),
    );
  },
  /** Marks one of the member's own warnings read; another's changes nothing. */
  acknowledgeModerationNotice: (
    scope: Scope,
    input: { readonly id: string; readonly now: string },
    authorize: OwnCollectionFence<Scope>,
  ): Promise<void> => {
    requireOwnScope(scope);
    return instrumented(eventSink, 'acknowledgeModerationNotice', () =>
      readOwnCollection(database, scope, authorize, async (tx) => {
        await tx.execute(sql`update moderation_actions
          set acknowledged_at = ${new Date(input.now)}
          where id = ${input.id} and user_id = ${scope.userId} and kind = 'warning' and acknowledged_at is null`);
      }),
    );
  },
  /** Sanctions on an account erased before `before` (DEC-298, COMP-4). */
  purgeErasedModeration: (input: {
    readonly before: string;
    readonly limit: number;
  }): Promise<number> =>
    instrumented(eventSink, 'purgeErasedModeration', async () => {
      const rows = await database.execute(sql`
        delete from moderation_actions where id in (
          select m.id from moderation_actions m join users u on u.id = m.user_id
          where u.deleted_at <= ${new Date(input.before)}
          limit ${input.limit})
        returning id`);
      return rows.length;
    }),
});
