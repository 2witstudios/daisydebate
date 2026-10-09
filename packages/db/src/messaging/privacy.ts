import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic, idSchema } from '@daisy/protocol';
import { appendOutboxEvent } from '../outbox';
import type { AuthorizationTransaction } from '../authorization';
import {
  messagingPrivacyFields,
  type PrivacyAdopter,
  type PrivacyExport,
} from '../privacy';

type ChangedMessage = { id: string; channelId: string; authorActorId: string };
const rowsOf = <T>(rows: unknown) => rows as T[];

const exportRows = (rows: readonly Record<string, unknown>[]) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'bigint'
            ? Number(value)
            : value,
      ]),
    ),
  );

function omitPrivateColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => !columns.includes(column)),
  );
}

/** Account lock is held by canonical PRIV before this pair -> channel fence. */
async function lockSubjectMessaging(
  tx: AuthorizationTransaction,
  actorId: string,
) {
  idSchema.parse(actorId);
  await tx.execute(
    sql`select low_actor_id from messaging_contact_pairs where low_actor_id=${actorId} or high_actor_id=${actorId} order by low_actor_id,high_actor_id for update`,
  );
  await tx.execute(sql`
    select id from messaging_channels where id in (
      select channel_id from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}
      union select channel_id from messaging_group_grants where actor_id=${actorId}
      union select channel_id from messaging_messages where author_actor_id=${actorId}
      union select channel_id from messaging_reactions where actor_id=${actorId}
      union select channel_id from messaging_actor_states where actor_id=${actorId}
      union select channel_id from messaging_receipts where actor_id=${actorId}
      union select channel_id from messaging_group_invitations where invitee_actor_id=${actorId} or invited_by_actor_id=${actorId}
      union select result_channel_id from messaging_social_commands where actor_id=${actorId} or counterpart_actor_id=${actorId}
    ) order by id for update
  `);
}

async function advanceChannel(
  tx: AuthorizationTransaction,
  channelId: string,
  authority: boolean,
) {
  const rows = rowsOf<{ changeVersion: number }>(
    await tx.execute(sql`
    update messaging_channels set change_version=change_version+1,
      authority_revision=authority_revision+${authority ? 1 : 0}
    where id=${channelId} and change_version < 9007199254740991 and authority_revision < 9007199254740991
    returning change_version as "changeVersion"
  `),
  );
  if (!rows[0]) throw createAppError('CONFLICT');
  return Number(rows[0].changeVersion);
}

async function scrubSubjectMessages(
  tx: AuthorizationTransaction,
  actorId: string,
  now: string,
  versions: Map<string, number>,
) {
  const messages = rowsOf<ChangedMessage>(
    await tx.execute(sql`
    select m.id,m.channel_id as "channelId",m.author_actor_id as "authorActorId"
    from messaging_messages m where
      (m.author_actor_id=${actorId} and (m.text is not null or m.removed_at is null))
      or exists (select 1 from messaging_reactions r where r.message_id=m.id and r.channel_id=m.channel_id and r.actor_id=${actorId})
    order by m.channel_id,m.sequence
  `),
  );
  for (const message of messages) {
    const version = await advanceChannel(tx, message.channelId, false);
    await tx.execute(sql`
      update messaging_messages set
        text=case when author_actor_id=${actorId} then null else text end,
        removed_at=case when author_actor_id=${actorId} then coalesce(removed_at,${now}::timestamptz) else removed_at end,
        change_version=${version}
      where id=${message.id} and channel_id=${message.channelId}
    `);
    versions.set(message.channelId, version);
  }
}

async function eraseAssociations(
  tx: AuthorizationTransaction,
  actorId: string,
  versions: Map<string, number>,
) {
  const authorityChannels = rowsOf<{ channelId: string }>(
    await tx.execute(sql`
    select channel_id as "channelId" from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}
    union select channel_id as "channelId" from messaging_group_grants where actor_id=${actorId}
    order by "channelId"
  `),
  );
  await tx.execute(
    sql`delete from messaging_social_commands where actor_id=${actorId} or counterpart_actor_id=${actorId} or result_channel_id in (select channel_id from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId})`,
  );
  await tx.execute(
    sql`delete from messaging_group_invitations where invitee_actor_id=${actorId} or invited_by_actor_id=${actorId}`,
  );
  await tx.execute(
    sql`delete from messaging_receipts where actor_id=${actorId}`,
  );
  await tx.execute(
    sql`delete from messaging_reactions where actor_id=${actorId}`,
  );
  await tx.execute(
    sql`delete from messaging_actor_states where actor_id=${actorId}`,
  );
  await tx.execute(
    sql`delete from messaging_group_grants where actor_id=${actorId}`,
  );
  await tx.execute(
    sql`delete from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}`,
  );
  await tx.execute(
    sql`delete from messaging_contact_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}`,
  );
  for (const { channelId } of authorityChannels) {
    await tx.execute(
      sql`update messaging_channels c set lifecycle='archived' where c.id=${channelId} and c.kind='private_group' and not exists(select 1 from messaging_group_grants g where g.channel_id=c.id and g.role='manager' and g.revoked_at is null)`,
    );
    versions.set(channelId, await advanceChannel(tx, channelId, true));
  }
}

/** No retention exception, nested transaction, external store or inferred title owner. */
export function createMessagingPrivacyAdopter(): PrivacyAdopter {
  return {
    id: 'messaging',
    phase: 'before-auth',
    fields: messagingPrivacyFields,
    async erase(tx, subject, context) {
      const now = z.iso.datetime().parse(context.now);
      await lockSubjectMessaging(tx, subject.actorId);
      const versions = new Map<string, number>();
      await scrubSubjectMessages(tx, subject.actorId, now, versions);
      await eraseAssociations(tx, subject.actorId, versions);
      for (const [channelId, version] of versions)
        await appendOutboxEvent(tx, {
          topic: buildChannelTopic(channelId),
          kind: 'channel.changed',
          version: 1,
          payload: {
            kind: 'channel.changed',
            channelId,
            changeVersion: version,
          },
        });
    },
    async export(tx, subject): Promise<PrivacyExport> {
      await lockSubjectMessaging(tx, subject.actorId);
      const actorId = subject.actorId;
      const messages = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_messages where author_actor_id=${actorId} order by channel_id,sequence`,
        ),
      );
      const preferences = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_actor_states where actor_id=${actorId} order by channel_id`,
        ),
      );
      const grants = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_group_grants where actor_id=${actorId} order by channel_id`,
        ),
      );
      const receipts = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_receipts where actor_id=${actorId} order by channel_id,request_id`,
        ),
      );
      const reactions = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_reactions where actor_id=${actorId} order by channel_id,message_id`,
        ),
      );
      const contacts = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_contact_pairs where low_actor_id=${actorId} or high_actor_id=${actorId} order by low_actor_id,high_actor_id`,
        ),
      ).map((row) => ({
        low_actor_id: row.low_actor_id,
        high_actor_id: row.high_actor_id,
        revision: row.revision,
        ...(row.low_actor_id === actorId
          ? { low_blocks_high: row.low_blocks_high }
          : { high_blocks_low: row.high_blocks_low }),
      }));
      const pairs = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId} order by channel_id`,
        ),
      );
      const ownPairs = pairs.map((row) => {
        if (row.request_sender_actor_id === actorId) return row;
        return omitPrivateColumns(row, ['introduction']);
      });
      const commands = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_social_commands where actor_id=${actorId} order by created_at,request_id`,
        ),
      );
      const invitations = rowsOf<Record<string, unknown>>(
        await tx.execute(
          sql`select * from messaging_group_invitations where invitee_actor_id=${actorId} or invited_by_actor_id=${actorId} order by channel_id,invitee_actor_id`,
        ),
      ).map((row) => {
        if (row.invitee_actor_id === actorId) return row;
        return omitPrivateColumns(row, ['state', 'decided_at']);
      });
      // Shared title has no subject attribution. Never export another author's
      // text/title by guessing ownership from current membership.
      return Object.fromEntries(
        Object.entries({
          messaging_channels: [],
          messaging_messages: messages,
          messaging_actor_states: preferences,
          messaging_group_grants: grants,
          messaging_receipts: receipts,
          messaging_reactions: reactions,
          messaging_contact_pairs: contacts,
          messaging_dm_pairs: ownPairs,
          messaging_social_commands: commands,
          messaging_group_invitations: invitations,
        }).map(([table, rows]) => [table, exportRows(rows)]),
      );
    },
  };
}
