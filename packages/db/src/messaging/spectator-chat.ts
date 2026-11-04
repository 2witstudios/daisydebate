import { createAppError } from '@daisy/errors';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readAuthorizationActors } from '../authorization';
import type { SpectatorChatModeration } from '../content-moderation-ports';
import { inLiveRoomSql, liveRoomOfR } from '../live-room-sql';
import { rowsOf } from '../raw-rows';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import { messageRecord } from './message-record';
import type {
  MessagingCreateSendPlan,
  MessagingMessageRecord,
  MessagingSendCommand,
  MessagingSendState,
} from './records';
import { appendStream, lockStream, openStream } from './stream';

type Tx = Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;

/** The Round's side of a post: what its Broadcast allows, as read under the stream lock. */
export type SpectatorChannelFacts = {
  readonly broadcast: null | {
    readonly open: boolean;
    readonly slowModeSeconds: number;
  };
  readonly account: null | {
    readonly erased: boolean;
    readonly restricted: boolean;
    readonly underThirteen: boolean;
  };
  readonly banned: boolean;
  /** Ahead of the audience's feed, so they cannot post to it. */
  readonly inLiveRoom: boolean;
  readonly lastPostAtMs: number | null;
};

/** What decides whether a Round's audience takes this request, read in its transaction. */
export type RoundAudienceAdmission = {
  readonly visibility: 'public' | 'unlisted';
  readonly audienceLinkHash: string | null;
  readonly inLiveRoom: boolean;
};

/** The feature's pure decision over the facts, given the send state it plans from. */
export type SpectatorPostPlanner = (
  facts: SpectatorChannelFacts,
  state: MessagingSendState,
) =>
  | { readonly kind: 'replay'; readonly message: MessagingMessageRecord }
  | MessagingCreateSendPlan;

const channelOf = async (tx: Tx, roundId: string) => {
  const [row] = await rowsOf<{ id: string }>(
    tx,
    sql`select id from messaging_channels
      where round_id=${roundId} and kind='round_spectator'`,
  );
  return row?.id ?? null;
};

/** Each Round has its own channel, opened by its first post; a race keeps one. */
const openChannel = async (tx: Tx, roundId: string, channelId: string) => {
  const created = await rowsOf<{ id: string }>(
    tx,
    sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,round_id)
      values(${channelId},'round_spectator','round.spectator',1,'active',${roundId})
      on conflict (round_id) do nothing returning id`,
  );
  if (created[0]) {
    await openStream(tx, channelId);
    return channelId;
  }
  const existing = await channelOf(tx, roundId);
  if (!existing) throw createAppError('CONFLICT');
  return existing;
};

const receiptOf = async (
  tx: Tx,
  scope: {
    readonly channelId: string;
    readonly actorId: string;
    readonly requestId: string;
  },
) => {
  const [receipt] = await tx
    .select({
      payloadDigest: messagingReceipts.payloadDigest,
      messageId: messagingReceipts.messageId,
    })
    .from(messagingReceipts)
    .where(
      and(
        eq(messagingReceipts.channelId, scope.channelId),
        eq(messagingReceipts.actorId, scope.actorId),
        eq(messagingReceipts.requestId, scope.requestId),
      ),
    );
  if (!receipt) return { receipt: null, existingMessage: null };
  const [message] = receipt.messageId
    ? await tx
        .select()
        .from(messagingMessages)
        .where(
          and(
            eq(messagingMessages.id, receipt.messageId),
            eq(messagingMessages.channelId, scope.channelId),
          ),
        )
    : [];
  return {
    receipt,
    existingMessage: message ? messageRecord(message) : null,
  };
};

const audienceRound = (roundId: string, actorId: string) =>
  sql`select r.visibility,r.audience_link_hash,${inLiveRoomSql(liveRoomOfR, actorId)} as in_live_room
    from rounds r where r.id=${roundId} and r.visibility in ('public','unlisted') and r.room_id is not null`;

/**
 * Spectator chat over Messaging's own channel, stream and message tables
 * (SPECT-1.4, ADR 0108): one channel per Round, isolated from the floor, every
 * DM and every group. It takes the same lock order as any Messaging writer:
 * account under a shared fence, then the stream row, then content.
 */
export const spectatorChatOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /** Null when the Round has no audience for this request: to it, it does not exist. */
  postSpectatorChatMessage(
    input: {
      readonly roundId: string;
      readonly userId: string;
      readonly actorId: string;
      readonly newChannelId: string;
      readonly command: Omit<MessagingSendCommand, 'channelId'>;
      readonly admit: (admission: RoundAudienceAdmission) => boolean;
    },
    plan: SpectatorPostPlanner,
  ) {
    return instrumented(eventSink, 'postSpectatorChatMessage', () =>
      database.transaction(async (tx) => {
        const [account] = await readAuthorizationActors(tx, [input.actorId], {
          maxActors: 1,
        });
        const [round] = await rowsOf<{
          visibility: 'public' | 'unlisted';
          audience_link_hash: string | null;
          in_live_room: boolean;
        }>(tx, audienceRound(input.roundId, input.actorId));
        if (
          !round ||
          !input.admit({
            visibility: round.visibility,
            audienceLinkHash: round.audience_link_hash,
            inLiveRoom: round.in_live_room,
          })
        )
          return null;
        const [broadcast] = await rowsOf<{
          completed_at: unknown;
          stopped_at: unknown;
          chat_slow_mode_seconds: number;
        }>(
          tx,
          sql`select completed_at,stopped_at,chat_slow_mode_seconds from broadcasts where round_id=${input.roundId}`,
        );
        const channelId = await openChannel(
          tx,
          input.roundId,
          input.newChannelId,
        );
        const counters = await lockStream(tx, channelId);
        const [banned] = await rowsOf(
          tx,
          sql`select 1 from audience_bans where user_id=${input.userId}`,
        );
        const [last] = await rowsOf<{ at: string | Date | null }>(
          tx,
          sql`select max(created_at) as at from messaging_messages
            where channel_id=${channelId} and author_actor_id=${input.actorId}`,
        );
        const command: MessagingSendCommand = { ...input.command, channelId };
        const decided = plan(
          {
            broadcast: broadcast
              ? {
                  open:
                    broadcast.completed_at === null &&
                    broadcast.stopped_at === null,
                  slowModeSeconds: Number(broadcast.chat_slow_mode_seconds),
                }
              : null,
            account: account
              ? {
                  erased: account.erased,
                  restricted: account.restricted,
                  underThirteen: account.ageBand === 'under-13',
                }
              : null,
            banned: banned !== undefined,
            inLiveRoom: round.in_live_room,
            lastPostAtMs: last?.at ? new Date(last.at).getTime() : null,
          },
          {
            counters: { channelId, ...counters },
            ...(await receiptOf(tx, {
              channelId,
              actorId: input.actorId,
              requestId: command.requestId,
            })),
            reply: null,
          },
        );
        if (decided.kind === 'replay') return decided.message;
        await appendStream(tx, channelId, { messages: 1, changes: 1 });
        await tx.insert(messagingMessages).values({
          ...decided.message,
          createdAt: new Date(decided.message.createdAt),
          editedAt: null,
          removedAt: null,
        });
        await tx.insert(messagingReceipts).values({
          channelId,
          actorId: input.actorId,
          requestId: command.requestId,
          ...decided.receipt,
        });
        return decided.message;
      }),
    );
  },
  /**
   * A Round's newest messages, oldest first, as soon as they are posted: chat is
   * the audience talking to itself, so moderation alone stands between a post and
   * its readers (ADR 0108). A message has no author or words once it is removed or
   * its author erased.
   */
  readSpectatorChat(input: {
    readonly roundId: string;
    readonly limit: number;
    readonly beforeSequence?: number;
  }) {
    return instrumented(eventSink, 'readSpectatorChat', () =>
      readChatPage(database, input),
    );
  },
  /**
   * The retention sweep: a message goes 180 days after it was posted, with its
   * retry receipt, and spectator channels only, so no DM or group can be reached.
   */
  purgeExpiredSpectatorChat(input: {
    readonly before: string;
    readonly limit: number;
  }) {
    return instrumented(eventSink, 'purgeExpiredSpectatorChat', async () => {
      const gone = await rowsOf(
        database,
        sql`with due as (
            select m.id,m.channel_id from messaging_messages m
            join messaging_channels c on c.id=m.channel_id and c.kind='round_spectator'
            where m.created_at < ${input.before}::timestamptz limit ${input.limit}
          ), receipts as (
            delete from messaging_receipts x using due
            where x.message_id=due.id and x.channel_id=due.channel_id
          )
          delete from messaging_messages m using due
          where m.id=due.id and m.channel_id=due.channel_id returning m.id`,
      );
      return gone.length;
    });
  },
});

/** The chat page inside a caller's snapshot, so a whole audience read is one view. */
export const readChatPage = async (
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: {
    readonly roundId: string;
    readonly limit: number;
    readonly beforeSequence?: number;
  },
) => {
  const before =
    input.beforeSequence === undefined
      ? sql``
      : sql`and m.sequence < ${input.beforeSequence}`;
  const rows = await rowsOf<{
    id: string;
    sequence: number | string;
    at: string;
    text: string | null;
    username: string | null;
  }>(
    tx,
    sql`select m.id,m.sequence,m.text,u.username,
        to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
      from spectator_chat_messages m
      join actors a on a.id=m.author_actor_id
      left join users u on u.id=a.user_id and u.deleted_at is null
      where m.round_id=${input.roundId}
        ${before}
      order by m.sequence desc limit ${input.limit}`,
  );
  return rows.reverse().map((row) => ({
    id: row.id,
    sequence: Number(row.sequence),
    at: row.at,
    author: row.text === null ? null : row.username,
    text: row.text,
  }));
};

const spectatorMessage = (messageId: string) =>
  sql`select m.id,m.text,m.channel_id,m.author_actor_id,m.removed_at,a.user_id
    from messaging_messages m
    join messaging_channels c on c.id=m.channel_id and c.kind='round_spectator'
    join actors a on a.id=m.author_actor_id
    where m.id=${messageId}`;

/** A message as its reporter may know it: who wrote it, and whose audience holds it. */
const reportedMessage = (messageId: string, reporterActorId: string) =>
  sql`select m.author_actor_id,r.id as round_id,r.visibility,r.audience_link_hash,
      ${inLiveRoomSql(liveRoomOfR, reporterActorId)} as in_live_room
    from messaging_messages m
    join messaging_channels c on c.id=m.channel_id and c.kind='round_spectator'
    join rounds r on r.id=c.round_id
    where m.id=${messageId}`;

type SpectatorMessageRow = {
  readonly text: string | null;
  readonly channel_id: string;
  readonly author_actor_id: string;
  readonly removed_at: unknown;
  readonly user_id: string | null;
};

/**
 * Moderation's reach into spectator chat (WATCH-7): spectator messages only, so
 * no id can reach a DM or a group through it. Removal is content, so its revision
 * goes through the stream, as any other Messaging change does.
 */
export const spectatorChatModeration: SpectatorChatModeration = {
  readReportFacts: async (tx, input) => {
    const [row] = await rowsOf<{
      author_actor_id: string;
      round_id: string;
      visibility: 'public' | 'unlisted' | 'private';
      audience_link_hash: string | null;
      in_live_room: boolean;
    }>(tx, reportedMessage(input.messageId, input.reporterActorId));
    return row
      ? {
          ownMessage: row.author_actor_id === input.reporterActorId,
          audience: {
            roundId: row.round_id,
            visibility: row.visibility,
            audienceLinkHash: row.audience_link_hash,
            inLiveRoom: row.in_live_room,
          },
        }
      : null;
  },
  readSubject: async (tx, messageId) => {
    const [row] = await rowsOf<SpectatorMessageRow>(
      tx,
      spectatorMessage(messageId),
    );
    return row ? { text: row.text, authorUserId: row.user_id } : null;
  },
  remove: async (tx, input) => {
    const [row] = await rowsOf<SpectatorMessageRow>(
      tx,
      spectatorMessage(input.messageId),
    );
    if (!row) return null;
    if (row.removed_at !== null) return 'unchanged';
    const { changeVersion } = await appendStream(tx, row.channel_id, {
      messages: 0,
      changes: 1,
    });
    await tx.execute(sql`update messaging_messages set text=null,
        removed_at=${input.now.toISOString()}::timestamptz,change_version=${changeVersion}
      where id=${input.messageId} and channel_id=${row.channel_id}`);
    return 'applied';
  },
};
