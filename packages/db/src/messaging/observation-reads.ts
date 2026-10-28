import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema, type ChannelMessageRecord } from '@daisy/protocol';

/** The owner's header batch ceiling, matching the SQL function's slice. */
export const OBSERVATION_HEADER_BATCH = 1024;
const revision = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw createAppError('INFRASTRUCTURE');
  return parsed;
};
const iso = (value: unknown) =>
  value === null || value === undefined
    ? null
    : (value instanceof Date ? value : new Date(String(value))).toISOString();

/**
 * Channel observation reads (ADR 0089), through the `daisy_projection`
 * SECURITY DEFINER functions only: the realtime role holds EXECUTE, never a
 * grant on message content. Headers go on the `headers` lane, windows on
 * `projection`; the composition root decides which pool each one gets.
 */
export function channelObservationReads(
  database: Pick<BunSQLDatabase, 'execute'>,
) {
  return {
    /** Current content (stream) and disclosure (authority) revisions; absent ids are deleted channels. */
    async readChannelObservationHeaders(
      channelIds: readonly string[],
    ): Promise<
      ReadonlyMap<
        string,
        {
          readonly contentRevision: number;
          readonly disclosureRevision: number;
        }
      >
    > {
      if (channelIds.length > OBSERVATION_HEADER_BATCH)
        throw createAppError('VALIDATION');
      const ids = channelIds.map((id) => idSchema.parse(id));
      if (ids.length === 0) return new Map();
      const rows = (await database.execute(
        sql`select channel_id, change_version, authority_revision
          from public.daisy_observation_channel_headers(array[${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}]::text[])`,
      )) as unknown as Array<Record<string, unknown>>;
      return new Map(
        rows.map((row) => [
          String(row.channel_id),
          {
            contentRevision: revision(row.change_version),
            disclosureRevision: revision(row.authority_revision),
          },
        ]),
      );
    },
    /** The newest `limit + 1` messages and their revisions from one statement, or null for a deleted channel. */
    async readChannelObservationWindow(channelId: string, limit: number) {
      idSchema.parse(channelId);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw createAppError('VALIDATION');
      const rows = (await database.execute(
        sql`select * from public.daisy_observation_channel_messages(${channelId}::text, ${limit}::integer)`,
      )) as unknown as Array<Record<string, unknown>>;
      const header = rows[0];
      if (!header) return null;
      const records: ChannelMessageRecord[] = rows.flatMap((row) =>
        row.id === null || row.id === undefined
          ? []
          : [
              {
                id: String(row.id),
                channelId,
                authorActorId: String(row.author_actor_id),
                sequence: revision(row.sequence),
                changeVersion: revision(row.message_change_version),
                text: row.text === null ? null : String(row.text),
                createdAt: iso(row.created_at)!,
                editedAt: iso(row.edited_at),
                removedAt: iso(row.removed_at),
                ...(row.reply_to_message_id === null
                  ? {}
                  : { replyToMessageId: String(row.reply_to_message_id) }),
              },
            ],
      );
      return {
        contentRevision: revision(header.change_version),
        disclosureRevision: revision(header.authority_revision),
        records,
      };
    },
  };
}
export type ChannelObservationReads = ReturnType<
  typeof channelObservationReads
>;
