import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { decideRoomCommunity } from '@daisy/auth/room-community';
import { createAppError, isAppError } from '@daisy/errors';
import type { Fixture } from './constraint-helpers';
import { admitParticipants } from '../src/beta-access-testing';
import { createRoomCommunityStore } from '../src/messaging/room-community-store';
import type {
  RoomCommunityFence,
  RoomCommunityScope,
} from '../src/messaging/room-community-contracts';
export const { databaseUrl } = requireTestServices(process.env);
export const now = '2026-11-12T00:00:00.000Z';
const authorize: RoomCommunityFence = async ({
  scope,
  fact,
  account,
  action,
}) => {
  if (
    !decideRoomCommunity({ principal: scope, fact, account, action, now }).allow
  )
    throw createAppError('AUTHORIZATION');
};
export const refusal = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return null;
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
};
/** An admitted member with a human actor. */
export const member = async (f: Fixture) => {
  const userId = await f.user();
  await admitParticipants(f.sql, [userId]);
  await f.sql`update users set email_verified=true where id=${userId}`;
  return { userId, actorId: await f.actor(userId) };
};
export const seat = (
  f: Fixture,
  roomId: string,
  actorId: string,
  role: 'affirmative' | 'negative' | 'judge' = 'affirmative',
) =>
  f.sql`insert into room_participants(id,room_id,actor_id,role,slot) values(${createId()},${roomId},${actorId},${role},0)`;
/** A Room with its host and an opened chat; `room` overrides the Room row. */
export const prepared = async (
  f: Fixture,
  room: Record<string, unknown> = {},
) => {
  const host = await member(f);
  const roomId = await f.room(host.actorId, await f.format(), room);
  const scope = { roomId, ...host };
  const db = drizzle({ client: f.sql });
  const store = createRoomCommunityStore(db, authorize);
  const opened = await store.open({ ...scope, newChannelId: createId() });
  return { db, store, scope: { ...scope, channelId: opened.channelId } };
};
/** The Room ends as a Room command ends it: the status and that write's instant, with a new version. */
export const endRoom = (
  sql: SQL,
  roomId: string,
  status: 'started' | 'closed',
  at: string = now,
) =>
  sql`update rooms set status=${status},version=version+1,change_version=change_version+1,updated_at=${at}::timestamptz where id=${roomId}`;
export const send = (
  store: ReturnType<typeof createRoomCommunityStore>,
  scope: RoomCommunityScope,
  requestId = createId(),
  text = 'Room chat',
  hold: () => Promise<void> = async () => {},
) =>
  store.withChat(scope, async (frame) => {
    const state = await frame.readSendState({
      version: 1,
      channelId: scope.channelId,
      requestId,
      text,
    });
    const digest = createHash('sha3-256').update(text).digest('hex');
    if (state.receipt) {
      if (state.receipt.payloadDigest !== digest)
        throw createAppError('CONFLICT');
      return state.existingMessage!;
    }
    const message = {
      id: createId(),
      channelId: scope.channelId,
      authorActorId: scope.actorId,
      text,
      sequence: state.counters.messageSequence + 1,
      changeVersion: state.counters.changeVersion + 1,
      createdAt: now,
      editedAt: null,
      removedAt: null,
    };
    await hold();
    await frame.commitSend({
      kind: 'create',
      message,
      receipt: { messageId: message.id, payloadDigest: digest },
    });
    return message;
  });
export const waitForBlockedBy = async (f: Fixture, blocker: SQL) => {
  const [owner] = await blocker`select pg_backend_pid() as pid`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [waiting] =
      await f.sql`select count(*)::int as n from pg_stat_activity where ${Number(owner.pid)}=any(pg_blocking_pids(pid))`;
    if (Number(waiting.n) > 0) return;
    await Bun.sleep(10);
  }
  throw new Error(
    'Room chat writer did not reach the expected PostgreSQL fence',
  );
};
export const cleanupRoomChat = async (f: Fixture, roomId: string) => {
  await f.sql`delete from messaging_channels where room_id=${roomId}`;
};
