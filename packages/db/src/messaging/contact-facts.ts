import type { MessageRequestSetting } from '@daisy/protocol';
import type { DmRequestAction } from '@daisy/protocol/dm-policy';
import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  readAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import { rowsOf } from '../raw-rows';
import { currentTenantScope, scopeTransaction } from '../tenant-scope';

type Account = {
  readonly account: {
    readonly userId: string;
    readonly actorId: string | null;
  };
  readonly age: { readonly state: string; readonly band?: string };
};

type NewDmRequest = {
  readonly userId: string;
  readonly actorId: string;
  readonly recipientActorId: string;
};

const closed = {
  requestSetting: 'none' as const,
  friendActorIds: [],
  linkedAdultUserIds: [],
};

async function readDmRequestAction(
  tx: AuthorizationTransaction,
  recipientId: string,
  request: NewDmRequest,
) {
  const previous = await currentTenantScope(tx);
  await scopeTransaction(tx, { ...previous, subjectUserId: request.userId });
  const [row] = await rowsOf<{ action: DmRequestAction | null }>(
    tx,
    sql`select public.daisy_dm_request_access(${recipientId}, ${request.actorId}) as action`,
  );
  await scopeTransaction(tx, previous);
  if (!row) throw createAppError('INFRASTRUCTURE');
  return {
    ...closed,
    dmRequest: {
      initiatorActorId: request.actorId,
      action: row.action ?? 'none',
    },
  };
}

/**
 * What the DM rule reads about each account (decision 90, ADR 0160), in one
 * statement on the caller's fenced transaction: its message-request setting
 * (no row is everyone), the other accounts of the same cast it holds an
 * accepted friendship with, and, for a minor, their linked adults through
 * the one registered `daisy_linked_adult_users` (ADR 0158). One fact per
 * account, in the order given.
 */
export const bindMessagingContactFacts =
  (tx: AuthorizationTransaction, request?: NewDmRequest) =>
  async (accounts: readonly Account[]) => {
    if (request) {
      const recipient = accounts.find(
        ({ account }) => account.actorId === request.recipientActorId,
      );
      if (!recipient) return accounts.map(() => closed);
      const action = await readDmRequestAction(
        tx,
        recipient.account.userId,
        request,
      );
      return accounts.map((row) => (row === recipient ? action : closed));
    }

    // Only current age facts need conversation contact facts.
    const known = accounts.filter((row) => row.age.state === 'known');
    if (known.length === 0) return accounts.map(() => closed);
    const cast = JSON.stringify(
      known.map(({ account, age }) => ({
        user_id: account.userId,
        actor_id: account.actorId,
        minor:
          age.state === 'known' &&
          (age.band === '13-15' || age.band === '16-17'),
      })),
    );
    const rows = await rowsOf<{
      user_id: string;
      setting: MessageRequestSetting;
      friend_actor_ids: string[];
      linked_adult_user_ids: string[];
    }>(
      tx,
      sql`with cast_rows as (
          select * from jsonb_to_recordset(${cast}::text::jsonb)
            as c(user_id text, actor_id text, minor boolean))
        select c.user_id,
          coalesce(s.setting, 'everyone') as setting,
          array(select case when f.low_actor_id=c.actor_id
              then f.high_actor_id else f.low_actor_id end
            from friendships f
            where f.state='accepted'
              and c.actor_id in (f.low_actor_id, f.high_actor_id)
              and f.low_actor_id in (select actor_id from cast_rows)
              and f.high_actor_id in (select actor_id from cast_rows)
            order by 1) as friend_actor_ids,
          case when c.minor then array(select l.user_id
              from public.daisy_linked_adult_users(c.user_id) l order by 1)
            else '{}'::text[] end as linked_adult_user_ids
        from cast_rows c
        left join messaging_request_settings s on s.user_id=c.user_id`,
    );
    return accounts.map(({ account, age }) => {
      if (age.state !== 'known') return closed;
      const row = rows.find(
        (candidate) => candidate.user_id === account.userId,
      );
      if (!row) throw createAppError('INFRASTRUCTURE');
      return {
        requestSetting: row.setting,
        friendActorIds: row.friend_actor_ids,
        linkedAdultUserIds: row.linked_adult_user_ids,
      };
    });
  };

/**
 * A read for what a page offers between two members (Message or Add friend,
 * decision 90): both accounts under shared fences, in one transaction, handed
 * to `work` with that transaction for their age and contact facts, and
 * whether the pair is blocked or already has a pending or accepted DM. It
 * grants nothing; a request still decides under its own locks.
 */
export const createMessagingPairFactsRead =
  (database: BunSQLDatabase) =>
  <T>(
    actorIds: readonly [string, string],
    work: (
      tx: AuthorizationTransaction,
      accounts: Awaited<ReturnType<typeof readAuthorizationActors>>,
      contact: 'blocked' | 'open_dm' | 'none',
    ) => Promise<T>,
  ): Promise<T> =>
    database.transaction(async (tx) => {
      const [low, high] = [...actorIds].sort();
      const accounts = await readAuthorizationActors(tx, [low!, high!], {
        maxActors: 2,
      });
      const [pair] = await rowsOf<{ blocked: boolean; open: boolean | null }>(
        tx,
        sql`select p.low_blocks_high or p.high_blocks_low as blocked,
            d.request_state in ('pending','accepted') as open
          from contact_pairs p left join messaging_dm_pairs d
            using (low_actor_id, high_actor_id)
          where p.low_actor_id=${low} and p.high_actor_id=${high}`,
      );
      const contact = pair?.blocked
        ? 'blocked'
        : pair?.open
          ? 'open_dm'
          : 'none';
      return work(tx, accounts, contact);
    });
