import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  buildChannelTopic,
  idSchema,
  createMessagingReactionSchemas,
  type MessagingReactionPolicy,
} from '@daisy/protocol';
import { appendOutboxEvent } from '../outbox';
import type {
  MessagingReactionAssociation,
  MessagingReactionCommand,
} from './reaction-contracts';
type Tx = Pick<BunSQLDatabase, 'execute' | 'insert'>;
type Scope = { readonly actorId: string; readonly channelId: string };
type Guard = (
  operation: 'read' | 'add' | 'remove',
  association?: MessagingReactionAssociation,
) => Promise<void>;

/** Current canonical authority always precedes protected state and every actual change. */
export function channelReactionFrame(
  tx: Tx,
  scope: Scope,
  initialVersion: number,
  policy: MessagingReactionPolicy,
  authorize: Guard,
) {
  const schemas = createMessagingReactionSchemas(policy);
  let changeVersion = initialVersion;
  const result = async (
    command: Pick<MessagingReactionCommand, 'messageId'>,
    replayed: boolean,
    available: boolean,
  ) => {
    const rows = available
      ? await tx.execute(sql`
      select reaction, count(*)::text as count, bool_or(actor_id=${scope.actorId}) as own
      from messaging_reactions where channel_id=${scope.channelId} and message_id=${command.messageId}
      group by reaction order by reaction
    `)
      : [];
    await authorize('read');
    const parsed = schemas.result.safeParse({
      version: 1,
      channelId: scope.channelId,
      messageId: command.messageId,
      changeVersion,
      replayed,
      reactions: [...rows].map((row) => ({
        reaction: row.reaction,
        count: Number(row.count),
        own: row.own,
      })),
    });
    if (!parsed.success) throw createAppError('INFRASTRUCTURE');
    return parsed.data;
  };
  return {
    async read(input: string) {
      const parsed = idSchema.safeParse(input);
      if (!parsed.success) throw createAppError('VALIDATION');
      await authorize('read');
      const [message] = await tx.execute(sql`
        select id from messaging_messages where id=${parsed.data} and channel_id=${scope.channelId}
          and text is not null and removed_at is null for update
      `);
      if (message?.id !== parsed.data) throw createAppError('NOT_FOUND');
      return result({ messageId: parsed.data }, false, true);
    },
    async change(input: MessagingReactionCommand, payloadDigest: string) {
      const command = requireCommand(
        schemas.command,
        input,
        payloadDigest,
        scope.channelId,
      );
      const { available, own, receipt } = await readReactionState(
        tx,
        scope,
        command,
        authorize,
      );
      if (receipt) {
        requireReceipt(receipt, command, payloadDigest);
        return result(command, true, available);
      }
      if (!command.active && !own) throw createAppError('NOT_FOUND');
      await authorize(command.active ? 'add' : 'remove', own ?? undefined);
      const changed = command.active ? own === null : true;
      if (changed) {
        await changeAssociation(tx, scope, command);
        changeVersion = await advanceReactionVersion(
          tx,
          scope.channelId,
          command.messageId,
          changeVersion,
        );
      }
      await tx.execute(sql`
        insert into messaging_receipts(actor_id,channel_id,request_id,message_id,payload_digest)
        values(${scope.actorId},${scope.channelId},${command.requestId},${command.messageId},${payloadDigest})
      `);
      if (changed)
        await appendOutboxEvent(tx, {
          topic: buildChannelTopic(scope.channelId),
          kind: 'channel.changed',
          version: 1,
          payload: {
            kind: 'channel.changed',
            channelId: scope.channelId,
            changeVersion,
          },
        });
      if (command.active) await authorize('add');
      return result(command, false, available);
    },
  };
}

async function readOwnReaction(
  tx: Tx,
  scope: Scope,
  command: MessagingReactionCommand,
) {
  const [row] = await tx.execute(sql`
    select r.actor_id as "actorId", r.channel_id as "channelId", r.message_id as "messageId", r.reaction
    from messaging_reactions r join messaging_messages m on m.id=r.message_id and m.channel_id=r.channel_id
    where r.actor_id=${scope.actorId} and r.channel_id=${scope.channelId}
      and r.message_id=${command.messageId} and r.reaction=${command.reaction} for update of r
  `);
  if (!row) return null;
  if (
    row.actorId !== scope.actorId ||
    row.channelId !== scope.channelId ||
    row.messageId !== command.messageId ||
    row.reaction !== command.reaction
  )
    throw createAppError('CONFLICT');
  return {
    actorId: scope.actorId,
    channelId: scope.channelId,
    messageId: command.messageId,
    reaction: command.reaction,
  };
}
async function changeAssociation(
  tx: Tx,
  scope: Scope,
  command: MessagingReactionCommand,
) {
  const rows = command.active
    ? await tx.execute(sql`
    insert into messaging_reactions(actor_id,channel_id,message_id,reaction)
    values(${scope.actorId},${scope.channelId},${command.messageId},${command.reaction})
    returning actor_id as "actorId"
  `)
    : await tx.execute(sql`
    delete from messaging_reactions where actor_id=${scope.actorId} and channel_id=${scope.channelId}
      and message_id=${command.messageId} and reaction=${command.reaction} returning actor_id as "actorId"
  `);
  if (rows.length !== 1 || rows[0]?.actorId !== scope.actorId)
    throw createAppError('CONFLICT');
}
async function advanceReactionVersion(
  tx: Tx,
  channelId: string,
  messageId: string,
  previous: number,
) {
  const next = previous + 1;
  if (!Number.isSafeInteger(next) || previous < 0)
    throw createAppError('CONFLICT');
  const channels = await tx.execute(sql`
    update messaging_channels set change_version=${next} where id=${channelId} and change_version=${previous}
    returning id
  `);
  if (channels.length !== 1 || channels[0]?.id !== channelId)
    throw createAppError('CONFLICT');
  const messages = await tx.execute(sql`
    update messaging_messages set change_version=${next} where id=${messageId} and channel_id=${channelId}
      and change_version <= ${previous} returning id
  `);
  if (messages.length !== 1 || messages[0]?.id !== messageId)
    throw createAppError('CONFLICT');
  return next;
}

function requireCommand(
  schema: ReturnType<typeof createMessagingReactionSchemas>['command'],
  input: MessagingReactionCommand,
  payloadDigest: string,
  channelId: string,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success || !/^[0-9a-f]{64}$/.test(payloadDigest))
    throw createAppError('VALIDATION');
  if (parsed.data.channelId !== channelId) throw createAppError('NOT_FOUND');
  return parsed.data;
}
async function readReactionState(
  tx: Tx,
  scope: Scope,
  command: MessagingReactionCommand,
  authorize: Guard,
) {
  await authorize(command.active ? 'add' : 'read');
  const [message] = await tx.execute(sql`
    select id, channel_id as "channelId", text is not null and removed_at is null as available
    from messaging_messages where id=${command.messageId} and channel_id=${scope.channelId} for update
  `);
  if (
    !message ||
    message.id !== command.messageId ||
    message.channelId !== scope.channelId
  )
    throw createAppError('NOT_FOUND');
  if (command.active && message.available !== true)
    throw createAppError('NOT_FOUND');
  const own = await readOwnReaction(tx, scope, command);
  const [receipt] = await tx.execute(sql`
    select message_id as "messageId", payload_digest as "payloadDigest" from messaging_receipts
    where actor_id=${scope.actorId} and channel_id=${scope.channelId} and request_id=${command.requestId}
  `);
  return { available: message.available === true, own, receipt };
}
function requireReceipt(
  receipt: Record<string, unknown>,
  command: MessagingReactionCommand,
  payloadDigest: string,
) {
  if (
    receipt.messageId !== command.messageId ||
    receipt.payloadDigest !== payloadDigest
  )
    throw createAppError('CONFLICT');
}
