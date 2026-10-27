import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { botListenerOperations } from '../src/bot-listener';
import { withBoundedRound } from './bounded-transaction.test-support';
import { validRules } from './round-fixtures';
import { createBotSeat } from './bot-seat.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('the bot listener holds its own lease, apart from capture (ISSUE-764)', async () => {
  await withBoundedRound(async (fixture, transaction, roundId) => {
    const listener = botListenerOperations(transaction);
    const sessionId = createId(),
      workerId = createId(),
      segmentId = createId();
    const scope = { roundId, sessionId, workerId };
    await fixture.insert('media_sessions', {
      id: sessionId,
      round_id: roundId,
      room_name: createId(),
    });
    try {
      const bot = await createBotSeat(fixture, roundId, 'negative');
      const rule = validRules.segments.find((r) => r.type === 'speech')!;
      await fixture.insert('round_segments', {
        id: segmentId,
        round_id: roundId,
        sequence: 0,
        type: 'speech',
        rules_segment_key: rule.key,
        started_at: new Date(),
        duration_ms: rule.durationMs,
      });
      await fixture.sql`insert into media_worker_leases(session_id,worker_id,epoch,expires_at) values(${sessionId},${createId()},1,clock_timestamp()+interval '15 seconds')`;
      await assertRejects({
        given: 'a live capture lease and no listener lease',
        should: 'admit no listener read: capture authority is not listening',
        code: 'CONFLICT',
        actual: () => listener.readBotListenerState({ ...scope, epoch: 1 }),
      });
      const claimed = await listener.claimBotListenerLease({
        ...scope,
        leaseMs: 15000,
      });
      await assertRejects({
        given: 'another worker while that lease is live',
        should: 'refuse the claim as held',
        code: 'CONFLICT',
        actual: () =>
          listener.claimBotListenerLease({
            ...scope,
            workerId: createId(),
            leaseMs: 15000,
          }),
      });
      const renewed = await listener.claimBotListenerLease({
        ...scope,
        leaseMs: 15000,
        expectedEpoch: claimed.epoch,
      });
      const state = await listener.readBotListenerState({
        ...scope,
        epoch: claimed.epoch,
      });
      const check = await listener.readCurrentBotListenerLease({
        ...scope,
        epoch: claimed.epoch,
        segmentId,
      });
      assert({
        given: 'a claimed and renewed listener lease in an open segment',
        should:
          'keep its epoch and read the open segment, the bot seat and fresh server time',
        actual: [
          claimed.epoch,
          renewed.epoch,
          state.segment,
          state.participants.some(
            (p) => p.roundParticipantId === bot.id && p.kind === 'bot',
          ),
          Number.isFinite(Date.parse(check.serverNow)),
        ],
        expected: [
          1,
          1,
          { id: segmentId, type: 'speech', endedAt: null },
          true,
          true,
        ],
      });
      await fixture.sql`update bot_listener_leases set epoch=epoch+1, expires_at=clock_timestamp() where session_id=${sessionId}`;
      await assertRejects({
        given: 'a lease fenced as media-session rotation fences it',
        should: 'refuse every later batch check under the old epoch',
        code: 'CONFLICT',
        actual: () =>
          listener.readCurrentBotListenerLease({
            ...scope,
            epoch: claimed.epoch,
            segmentId,
          }),
      });
    } finally {
      await fixture.sql`delete from media_sessions where id=${sessionId}`;
    }
  });
});
