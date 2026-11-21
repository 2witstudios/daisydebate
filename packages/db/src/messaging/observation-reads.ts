import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema, type ChannelHistoryRecord } from '@daisy/protocol';
import type { Tx } from '../tx';
import { query, postgresInt8 } from '../raw-rows';

/** The owner's header batch ceiling, matching the SQL function's slice. */
const OBSERVATION_HEADER_BATCH = 1024;
/** Shared counts only: the function returns no reactor, so none can be sent. */
export const observationReactionCounts = z.array(
  z.object({ reaction: z.string(), count: z.number().int().positive() }),
);
export const observationWindowRow = z.object({
  id: z.string().nullable(),
  author_actor_id: z.string().nullable(),
  text: z.string().nullable(),
  reply_to_message_id: z.string().nullable(),
  created_at: z.date().nullable(),
  edited_at: z.date().nullable(),
  removed_at: z.date().nullable(),
  reactions: observationReactionCounts.nullable(),
  authority_revision: postgresInt8,
  change_version: postgresInt8,
  sequence: postgresInt8.nullable(),
  message_change_version: postgresInt8.nullable(),
});
const revision = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw createAppError('INFRASTRUCTURE');
  return parsed;
};
/**
 * Channel observation reads (ADR 0089), through two SECURITY DEFINER
 * functions only (`daisy_observation_channel_*`): the realtime role holds EXECUTE, never a
 * grant on message content. Headers go on the `headers` lane, windows on
 * `projection`; the composition root decides which pool each one gets.
 */
export function channelObservationReads(database: Tx) {
  return {
    /** Current content (stream) and disclosure (authority) revisions; absent ids are deleted channels. */
    async readChannelObservationHeaders(channelIds: readonly string[]): Promise<
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
      const rows = await query(
        database,
        z.object({
          channel_id: z.string(),
          change_version: postgresInt8,
          authority_revision: postgresInt8,
        }),
        sql`select channel_id, change_version, authority_revision
          from public.daisy_observation_channel_headers(array[${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}]::text[])`,
      );
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
      const rows = await query(
        database,
        observationWindowRow,
        sql`select * from public.daisy_observation_channel_messages(${channelId}::text, ${limit}::integer)`,
      );
      const header = rows[0];
      if (!header) return null;
      const records: ChannelHistoryRecord[] = rows.flatMap((row) => {
        if (row.id === null) return [];
        if (
          row.author_actor_id === null ||
          row.sequence === null ||
          row.message_change_version === null ||
          row.created_at === null
        )
          throw createAppError(
            'INVARIANT',
            'A channel message row is incomplete',
          );
        return [
          {
            id: row.id,
            channelId,
            authorActorId: row.author_actor_id,
            sequence: revision(row.sequence),
            changeVersion: revision(row.message_change_version),
            text: row.text,
            createdAt: row.created_at.toISOString(),
            editedAt: row.edited_at?.toISOString() ?? null,
            removedAt: row.removed_at?.toISOString() ?? null,
            reactions: row.reactions ?? [],
            ...(row.reply_to_message_id === null
              ? {}
              : { replyToMessageId: row.reply_to_message_id }),
          },
        ];
      });
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
