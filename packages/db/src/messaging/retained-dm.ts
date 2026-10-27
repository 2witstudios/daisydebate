import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import { eraseSubjectFiles } from '../messaging-files';

type Tx = AuthorizationTransaction;
type Survived = {
  readonly channelId: string;
  readonly survivorActorId: string;
};
const rowsOf = <T>(rows: unknown) => rows as T[];

/** The subject's DMs and who survives each, read before their pairs go. */
export async function survivingDms(tx: Tx, actorId: string) {
  return rowsOf<Survived>(
    await tx.execute(sql`
    select channel_id as "channelId",
      case when low_actor_id=${actorId} then high_actor_id else low_actor_id end as "survivorActorId"
    from messaging_dm_pairs where low_actor_id=${actorId} or high_actor_id=${actorId}
    order by channel_id
  `),
  );
}

/**
 * DEC-126, before the subject's files go: nothing the survivor keeps may
 * point at a subject message. Replies lose the pointer; a receipt for a
 * command on a subject message becomes ADR 0063's consumed-request marker
 * (no message, no fingerprint), so a retry never re-discloses it. The
 * survivor's read cursor and preferences go too: a retained channel has no
 * unread state, and its sequence never surfaces.
 */
export async function detachSurvivorsFromSubject(
  tx: Tx,
  actorId: string,
  dms: readonly Survived[],
) {
  for (const { channelId, survivorActorId } of dms) {
    const subjectMessages = sql`select id from messaging_messages where channel_id=${channelId} and author_actor_id=${actorId}`;
    await tx.execute(sql`
      update messaging_messages set reply_to_message_id=null
      where channel_id=${channelId} and reply_to_message_id in (${subjectMessages})
    `);
    await tx.execute(sql`
      update messaging_receipts set message_id=null, payload_digest=null
      where channel_id=${channelId} and message_id in (${subjectMessages})
    `);
    await tx.execute(
      sql`delete from messaging_actor_states where channel_id=${channelId} and actor_id=${survivorActorId}`,
    );
  }
}

/**
 * DEC-126, once the subject's files are gone: their DM rows are deleted
 * outright (their reactions and the survivor's reactions on them go with
 * them). A survivor with messages of their own keeps the channel as
 * `retained`, with their explicit retained-author grant; a survivor with
 * none keeps nothing, and the channel is deleted.
 */
export async function retainSurvivorDms(
  tx: Tx,
  actorId: string,
  dms: readonly Survived[],
  now: string,
) {
  const deleted: string[] = [];
  for (const { channelId, survivorActorId } of dms) {
    // detachSurvivorsFromSubject already cleared every receipt's pointer.
    await tx.execute(
      sql`delete from messaging_messages where channel_id=${channelId} and author_actor_id=${actorId}`,
    );
    const [own] = rowsOf<{ live: boolean }>(
      await tx.execute(
        sql`select exists(select 1 from messaging_messages where channel_id=${channelId} and author_actor_id=${survivorActorId} and removed_at is null) as "live"`,
      ),
    );
    if (own?.live) {
      await tx.execute(
        sql`update messaging_channels set lifecycle='retained', title=null, title_author_actor_id=null where id=${channelId}`,
      );
      await tx.execute(
        sql`insert into messaging_retained_authors(channel_id, actor_id, created_at) values (${channelId}, ${survivorActorId}, ${now}::timestamptz)`,
      );
    } else {
      // Nothing of the survivor's stays visible, so nothing of theirs stays.
      await eraseSubjectFiles(tx, survivorActorId, channelId);
      deleted.push(channelId);
    }
  }
  return deleted;
}

/**
 * Removes `actorId`'s retained authorship: their rows and files in each
 * retained channel they survive, and their grant. A channel left with no
 * retained author is deleted (m6, m7). The caller holds the channel locks.
 */
export async function eraseRetainedAuthorship(
  tx: Tx,
  actorId: string,
  channelIds: readonly string[],
) {
  idSchema.parse(actorId);
  for (const channelId of channelIds) {
    await eraseSubjectFiles(tx, actorId, channelId);
    await deleteAuthoredRows(tx, channelId, actorId);
    await tx.execute(
      sql`delete from messaging_retained_authors where channel_id=${channelId} and actor_id=${actorId}`,
    );
  }
  await deleteAbandonedChannels(tx, channelIds);
}

/**
 * Deletes a retained author's messages in one channel. Every receipt still
 * naming one of them (their own send and edit receipts) goes first, since
 * receipts hold a foreign key to their message.
 */
async function deleteAuthoredRows(tx: Tx, channelId: string, actorId: string) {
  const authored = sql`select id from messaging_messages where channel_id=${channelId} and author_actor_id=${actorId}`;
  await tx.execute(
    sql`delete from messaging_receipts where channel_id=${channelId} and message_id in (${authored})`,
  );
  await tx.execute(
    sql`delete from messaging_messages where channel_id=${channelId} and author_actor_id=${actorId}`,
  );
}

/** Deletes each channel no retained author holds and no DM pair fences. */
export async function deleteAbandonedChannels(
  tx: Tx,
  channelIds: readonly string[],
) {
  for (const channelId of channelIds)
    await tx.execute(sql`
      delete from messaging_channels c where c.id=${channelId} and c.kind='dm'
        and not exists(select 1 from messaging_retained_authors r where r.channel_id=c.id)
        and not exists(select 1 from messaging_dm_pairs p where p.channel_id=c.id)
    `);
}

/** The retained channels `actorId` survives, locked for their erasure. */
export async function retainedChannelsOf(tx: Tx, actorId: string) {
  return rowsOf<{ channelId: string }>(
    await tx.execute(
      sql`select channel_id as "channelId" from messaging_retained_authors where actor_id=${actorId} order by channel_id for update`,
    ),
  ).map((row) => row.channelId);
}

/** Refuses anyone but the channel's survivor exactly as a foreign channel. */
export async function requireRetainedAuthor(
  tx: Tx,
  actorId: string,
  channelId: string,
) {
  if (!idSchema.safeParse(channelId).success) throw createAppError('NOT_FOUND');
  const [row] = rowsOf<{ channelId: string }>(
    await tx.execute(sql`
    select r.channel_id as "channelId" from messaging_retained_authors r
    join messaging_channels c on c.id=r.channel_id and c.lifecycle='retained'
    where r.channel_id=${channelId} and r.actor_id=${actorId} for update of r
  `),
  );
  if (!row) throw createAppError('NOT_FOUND');
}
