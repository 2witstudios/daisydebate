import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { decideRoundFloor } from '@daisy/auth/round-floor';
import { createAppError, isAppError } from '@daisy/errors';
import type { Fixture } from './constraint-helpers';
import { createRoundFloorStore } from '../src/messaging/round-floor-store';
import type {
  RoundFloorFence,
  RoundFloorScope,
} from '../src/messaging/round-floor-contracts';
export const { databaseUrl } = requireTestServices(process.env);
export const now = '2026-11-07T00:00:00.000Z';
const authorize: RoundFloorFence = async ({ scope, fact, account, action }) => {
  if (!decideRoundFloor({ principal: scope, fact, account, action, now }).allow)
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
export const prepared = async (f: Fixture) => {
  const roundId = await f.round();
  const actorId = await f.participant(roundId, 'affirmative');
  const [user] = await f.sql`select user_id from actors where id=${actorId}`;
  await f.sql`update users set email_verified=true where id=${String(user.user_id)}`;
  const scope = { roundId, actorId, userId: String(user.user_id) };
  const db = drizzle({ client: f.sql });
  const store = createRoundFloorStore(db, authorize);
  const opened = await store.open({ ...scope, newChannelId: createId() });
  return { db, store, scope: { ...scope, channelId: opened.channelId } };
};
export const send = (
  store: ReturnType<typeof createRoundFloorStore>,
  scope: RoundFloorScope,
  requestId = createId(),
  text = 'Private floor',
  hold: () => Promise<void> = async () => {},
) =>
  store.withFloor(scope, async (frame) => {
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
  throw new Error('Floor writer did not reach the expected PostgreSQL fence');
};
export const cleanupFloor = async (f: Fixture, roundId: string) => {
  await f.sql`delete from messaging_channels where round_id=${roundId}`;
};
