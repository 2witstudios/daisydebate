import { mailJobStates } from '../schema/columns';
import { appendStream } from './stream';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { queueObservationPurge } from '../observation-purge-jobs';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import {
  messageRequestSettingSchema,
  messagingGroupInvitationStates,
} from '@daisy/protocol/messaging/social';
import { eraseSubjectFiles, exportSubjectFiles } from '../messaging-files';
import {
  deleteAbandonedChannels,
  detachSurvivorsFromSubject,
  eraseRetainedAuthorship,
  retainSurvivorDms,
  retainedChannelsOf,
  survivingDms,
} from './retained-dm';
import { exportRows } from '../privacy/export-rows';
import type { PrivacyAdopter, PrivacyExport } from '../privacy';
import type { Tx } from '../tx';
import { postgresInt8, run, query } from '../raw-rows';

function omitPrivateColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => !columns.includes(column)),
  );
}

/** Account lock is held by canonical PRIV before this pair -> channel fence. */
async function lockSubjectMessaging(tx: Tx, actorId: string) {
  idSchema.parse(actorId);
  await run(
    tx,
    sql`select low_actor_id from contact_pairs where low_actor_id=${actorId} or high_actor_id=${actorId} order by low_actor_id,high_actor_id for update`,
  );
  // Floor lifecycle precedes its channel in every lock graph, including erasure.
  await run(
    tx,
    sql`select r.id from rounds r where exists (
    select 1 from messaging_channels c where c.round_id=r.id and c.kind='round_floor' and (
      exists(select 1 from messaging_messages m where m.channel_id=c.id and m.author_actor_id=${actorId})
      or exists(select 1 from messaging_actor_states s where s.channel_id=c.id and s.actor_id=${actorId})
      or exists(select 1 from messaging_receipts x where x.channel_id=c.id and x.actor_id=${actorId})
    )
  ) order by r.id for share`,
  );
  // Room chat keeps the same order: the Room before its channel.
  await run(
    tx,
    sql`select r.id from rooms r where exists (
    select 1 from messaging_channels c where c.room_id=r.id and c.kind='room_community' and (
      exists(select 1 from messaging_messages m where m.channel_id=c.id and m.author_actor_id=${actorId})
      or exists(select 1 from messaging_actor_states s where s.channel_id=c.id and s.actor_id=${actorId})
      or exists(select 1 from messaging_receipts x where x.channel_id=c.id and x.actor_id=${actorId})
    )
  ) order by r.id for share`,
  );
  await run(
    tx,
    sql`
    select id from messaging_channels where id in (
      select channel_id from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}
      union select id from messaging_channels where title_author_actor_id=${actorId}
      union select channel_id from messaging_group_grants where actor_id=${actorId}
      union select channel_id from messaging_messages where author_actor_id=${actorId}
      union select channel_id from messaging_reactions where actor_id=${actorId}
      union select channel_id from messaging_actor_states where actor_id=${actorId}
      union select channel_id from messaging_receipts where actor_id=${actorId}
      union select channel_id from messaging_group_invitations where invitee_actor_id=${actorId} or invited_by_actor_id=${actorId}
      union select result_channel_id from messaging_social_commands where actor_id=${actorId} or counterpart_actor_id=${actorId}
      union select channel_id from messaging_files where owner_actor_id=${actorId}
      union select channel_id from messaging_retained_authors where actor_id=${actorId}
      union select c.result_channel_id from messaging_social_commands c join messaging_social_command_subjects s on s.actor_id=c.actor_id and s.request_id=c.request_id where s.subject_actor_id=${actorId}
    ) order by id for update
  `,
  );
}

/** Erasure is content: its revision goes through the stream; authority moves separately. */
async function advanceChannel(tx: Tx, channelId: string, authority: boolean) {
  if (authority) {
    const rows = await query(
      tx,
      z.object({ id: z.string() }),
      sql`
      update messaging_channels set authority_revision=authority_revision+1
      where id=${channelId} and authority_revision < 9007199254740991 returning id
    `,
    );
    if (!rows[0]) throw createAppError('CONFLICT');
  }
  const { changeVersion } = await appendStream(tx, channelId, {
    messages: 0,
    changes: 1,
  });
  return changeVersion;
}

async function scrubSubjectMessages(
  tx: Tx,
  actorId: string,
  now: string,
  versions: Map<string, number>,
) {
  const messages = await query(
    tx,
    z.object({
      id: z.string(),
      channelId: z.string(),
      authorActorId: z.string(),
    }),
    sql`
    select m.id,m.channel_id as "channelId",m.author_actor_id as "authorActorId"
    from messaging_messages m where
      (m.author_actor_id=${actorId} and (m.text is not null or m.removed_at is null))
      or exists (select 1 from messaging_reactions r where r.message_id=m.id and r.channel_id=m.channel_id and r.actor_id=${actorId})
    order by m.channel_id,m.sequence
  `,
  );
  for (const message of messages) {
    const version = await advanceChannel(tx, message.channelId, false);
    await run(
      tx,
      sql`
      update messaging_messages set
        text=case when author_actor_id=${actorId} then null else text end,
        removed_at=case when author_actor_id=${actorId} then coalesce(removed_at,${now}::timestamptz) else removed_at end,
        change_version=${version}
      where id=${message.id} and channel_id=${message.channelId}
    `,
    );
    versions.set(message.channelId, version);
  }
}

async function eraseSubjectTitles(
  tx: Tx,
  actorId: string,
  versions: Map<string, number>,
) {
  const channels = await query(
    tx,
    z.object({ channelId: z.string() }),
    sql`select id as "channelId" from messaging_channels where title_author_actor_id=${actorId} order by id`,
  );
  for (const { channelId } of channels) {
    const version = await advanceChannel(tx, channelId, false);
    await run(
      tx,
      sql`update messaging_channels set title=null,title_author_actor_id=null where id=${channelId} and title_author_actor_id=${actorId}`,
    );
    versions.set(channelId, version);
  }
}

async function eraseAssociations(
  tx: Tx,
  actorId: string,
  versions: Map<string, number>,
) {
  const authorityChannels = await query(
    tx,
    z.object({ channelId: z.string() }),
    sql`
    select channel_id as "channelId" from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}
    union select channel_id as "channelId" from messaging_group_grants where actor_id=${actorId}
    order by "channelId"
  `,
  );
  await run(
    tx,
    sql`delete from messaging_social_commands c where actor_id=${actorId} or counterpart_actor_id=${actorId} or exists (select 1 from messaging_social_command_subjects s where s.actor_id=c.actor_id and s.request_id=c.request_id and s.subject_actor_id=${actorId}) or result_channel_id in (select channel_id from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId})`,
  );
  await run(
    tx,
    sql`delete from messaging_group_invitations where invitee_actor_id=${actorId} or invited_by_actor_id=${actorId}`,
  );
  await run(tx, sql`delete from messaging_receipts where actor_id=${actorId}`);
  await run(tx, sql`delete from messaging_reactions where actor_id=${actorId}`);
  await run(
    tx,
    sql`delete from messaging_actor_states where actor_id=${actorId}`,
  );
  await run(
    tx,
    sql`delete from messaging_group_grants where actor_id=${actorId}`,
  );
  // Messaging's own pair rows; Friends, Presence and Contacts erase theirs.
  await run(
    tx,
    sql`delete from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}`,
  );
  for (const { channelId } of authorityChannels) {
    await run(
      tx,
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
    async erase(tx, subject, context) {
      const now = z.iso.datetime().parse(context.now);
      await lockSubjectMessaging(tx, subject.actorId);
      const versions = new Map<string, number>();
      // DEC-126 (ADR 0086): a DM survivor keeps only their own rows.
      const dms = await survivingDms(tx, subject.actorId);
      // Every version advance comes first, so an exhausted one refuses
      // before anything is deleted.
      await scrubSubjectMessages(tx, subject.actorId, now, versions);
      await eraseSubjectTitles(tx, subject.actorId, versions);
      await eraseRetainedAuthorship(
        tx,
        subject.actorId,
        await retainedChannelsOf(tx, subject.actorId),
      );
      await detachSurvivorsFromSubject(tx, subject.actorId, dms);
      await eraseSubjectFiles(tx, subject.actorId);
      const abandoned = await retainSurvivorDms(tx, subject.actorId, dms, now);
      await eraseAssociations(tx, subject.actorId, versions);
      await deleteAbandonedChannels(tx, abandoned);
      // Cached observation copies of what was just erased are purged by a
      // durable, retried job queued in this same transaction (ISSUE-852).
      await queueObservationPurge(tx, subject.userId, now);
      await run(
        tx,
        sql`delete from messaging_unread_emails where user_id=${subject.userId}`,
      );
      // Erasure keeps the user row (ADR 0087), so its own choice goes here.
      await run(
        tx,
        sql`delete from messaging_request_settings where user_id=${subject.userId}`,
      );
    },
    async export(tx, subject): Promise<PrivacyExport> {
      await lockSubjectMessaging(tx, subject.actorId);
      const actorId = subject.actorId;
      const messages = await query(
        tx,
        z.object({
          id: z.string(),
          channel_id: z.string(),
          author_actor_id: z.string(),
          sequence: postgresInt8,
          change_version: postgresInt8,
          text: z.string().nullable(),
          reply_to_message_id: z.string().nullable(),
          created_at: z.date(),
          edited_at: z.date().nullable(),
          removed_at: z.date().nullable(),
        }),
        sql`select * from messaging_messages where author_actor_id=${actorId} order by channel_id,sequence`,
      );
      const preferences = await query(
        tx,
        z.object({
          channel_id: z.string(),
          actor_id: z.string(),
          following: z.boolean(),
          hidden: z.boolean(),
          notification_level: z.string(),
          read_sequence: postgresInt8,
        }),
        sql`select * from messaging_actor_states where actor_id=${actorId} order by channel_id`,
      );
      const grants = await query(
        tx,
        z.object({
          channel_id: z.string(),
          channel_kind: z.string(),
          actor_id: z.string(),
          role: z.string(),
          generation: postgresInt8,
          granted_at: z.date(),
          revoked_at: z.date().nullable(),
        }),
        sql`select * from messaging_group_grants where actor_id=${actorId} order by channel_id`,
      );
      const receipts = await query(
        tx,
        z.object({
          channel_id: z.string(),
          actor_id: z.string(),
          request_id: z.string(),
          payload_digest: z.string().nullable(),
          message_id: z.string().nullable(),
        }),
        sql`select * from messaging_receipts where actor_id=${actorId} order by channel_id,request_id`,
      );
      const reactions = await query(
        tx,
        z.object({
          channel_id: z.string(),
          message_id: z.string(),
          actor_id: z.string(),
          reaction: z.string(),
        }),
        sql`select * from messaging_reactions where actor_id=${actorId} order by channel_id,message_id`,
      );
      const pairs = await query(
        tx,
        z.object({
          low_actor_id: z.string(),
          high_actor_id: z.string(),
          channel_id: z.string(),
          channel_kind: z.string(),
          request_sender_actor_id: z.string(),
          request_state: z.string(),
          requested_at: z.date(),
          decided_at: z.date().nullable(),
          introduction: z.string().nullable(),
        }),
        sql`select * from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId} order by channel_id`,
      );
      const ownPairs = pairs.map((row) => {
        if (row.request_sender_actor_id === actorId) return row;
        return omitPrivateColumns(row, ['introduction']);
      });
      const retained = await query(
        tx,
        z.object({
          channel_id: z.string(),
          actor_id: z.string(),
          created_at: z.date(),
        }),
        sql`select * from messaging_retained_authors where actor_id=${actorId} order by channel_id`,
      );
      const commands = await query(
        tx,
        z.object({
          actor_id: z.string(),
          request_id: z.string(),
          kind: z.string(),
          digest: z.string().nullable(),
          result_channel_id: z.string().nullable(),
          created_at: z.date(),
          counterpart_actor_id: z.string().nullable(),
        }),
        sql`select * from messaging_social_commands where actor_id=${actorId} order by created_at,request_id`,
      );
      const commandSubjects = await query(
        tx,
        z.object({
          actor_id: z.string(),
          request_id: z.string(),
          subject_actor_id: z.string(),
        }),
        sql`select * from messaging_social_command_subjects where actor_id=${actorId} or subject_actor_id=${actorId} order by actor_id,request_id,subject_actor_id`,
      );
      const invitations = (
        await query(
          tx,
          z.object({
            channel_id: z.string(),
            channel_kind: z.string(),
            invitee_actor_id: z.string(),
            invited_by_actor_id: z.string(),
            generation: postgresInt8,
            state: z.enum(messagingGroupInvitationStates),
            invited_at: z.date(),
            decided_at: z.date().nullable(),
          }),
          sql`select * from messaging_group_invitations where invitee_actor_id=${actorId} or invited_by_actor_id=${actorId} order by channel_id,invitee_actor_id`,
        )
      ).map((row) => {
        if (row.invitee_actor_id === actorId) return row;
        return omitPrivateColumns(row, ['state', 'decided_at']);
      });
      const channels = await query(
        tx,
        z.object({
          id: z.string(),
          title: z.string().nullable(),
          title_author_actor_id: z.string().nullable(),
        }),
        sql`select id,title,title_author_actor_id from messaging_channels where title_author_actor_id=${actorId} order by id`,
      );
      const files = await exportSubjectFiles(tx, actorId);
      const requestSettings = await query(
        tx,
        z.object({
          setting: messageRequestSettingSchema.shape.setting,
          updated_at: z.date(),
        }),
        sql`select setting,updated_at from messaging_request_settings
            where user_id=(select user_id from actors where id=${actorId})`,
      );
      // Read last: Messaging's own email jobs, after every other table.
      const unreadEmails = await query(
        tx,
        z.object({
          state: z.enum(mailJobStates),
          attempts: z.int(),
          last_error_code: z.string().nullable(),
          first_owed_at: z.date(),
          created_at: z.date(),
          completed_at: z.date().nullable(),
        }),
        sql`select state,attempts,last_error_code,first_owed_at,created_at,completed_at
            from messaging_unread_emails
            where user_id=(select user_id from actors where id=${actorId}) order by created_at,id`,
      );
      return Object.fromEntries(
        Object.entries({
          ...files,
          messaging_channels: channels,
          messaging_messages: messages,
          messaging_actor_states: preferences,
          messaging_group_grants: grants,
          messaging_receipts: receipts,
          messaging_reactions: reactions,
          messaging_dm_pairs: ownPairs,
          messaging_social_commands: commands,
          messaging_retained_authors: retained,
          messaging_social_command_subjects: commandSubjects,
          messaging_group_invitations: invitations,
          messaging_request_settings: requestSettings,
          messaging_unread_emails: unreadEmails,
        }).map(([table, rows]) => [table, exportRows(rows)]),
      );
    },
  };
}
