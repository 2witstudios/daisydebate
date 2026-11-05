import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  flagKeySchema,
  flagStates,
  type FlagSnapshot,
} from '@daisy/protocol/flags';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';

export type FlagReadTransaction = Pick<BunSQLDatabase, 'execute'>;
const rowSchema = z.object({
  key: flagKeySchema,
  revision: z.coerce.number().int().min(0),
  state: z.enum(flagStates),
  enabled: z.boolean().nullable(),
  expires_at: z.coerce.number().finite().nullable(),
  now_ms: z.coerce.number().finite(),
});

export function requireFlagKeys(keys: readonly string[]) {
  if (
    keys.length < 1 ||
    keys.length > 32 ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !flagKeySchema.safeParse(key).success)
  )
    throw createAppError('VALIDATION');
}

/** One statement gives one coherent snapshot and one database instant. */
export async function readFlagSnapshot(
  database: FlagReadTransaction,
  accountId: string | null,
  keys: readonly string[],
): Promise<{ readonly snapshot: FlagSnapshot; readonly now: number }> {
  requireFlagKeys(keys);
  if (accountId !== null && !idSchema.safeParse(accountId).success)
    throw createAppError('VALIDATION');
  const rows = await database.execute(sql`with instant as materialized (
      select extract(epoch from clock_timestamp()) * 1000 as now_ms
    ) select requested.key, coalesce(f.revision, 0) as revision,
      coalesce(f.state, 'default') as state, o.enabled,
      extract(epoch from o.expires_at) * 1000 as expires_at, instant.now_ms
    from unnest(array[${sql.join(
      keys.map((key) => sql`${key}`),
      sql`, `,
    )}]::text[]) as requested(key)
    cross join instant
    left join release_flags f on f.key = requested.key
    left join flag_account_overrides o on o.key = f.key and o.user_id = ${accountId}
      and exists(select 1 from users u where u.id = o.user_id and u.deleted_at is null)
    order by requested.key`);
  const parsed = z.array(rowSchema).length(keys.length).parse(rows);
  return {
    now: parsed[0]!.now_ms,
    snapshot: {
      kind: 'available',
      flags: parsed.map((row) => ({
        key: row.key,
        revision: row.revision,
        state: row.state,
        override:
          row.enabled === null || row.expires_at === null
            ? null
            : { enabled: row.enabled, expiresAt: row.expires_at },
      })),
    },
  };
}
