import { mediaTestHuman } from './media-session.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { createBoundedTransaction } from '../src/bounded-transaction';
import { lockMediaRound } from '../src/media-session-authority';
import { withFixture, sqlStateOf } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('media authority fence permits durable attendance marker FK admission while excluding Round writers', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { roundId, seat } = await mediaTestHuman(fixture);
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const run = createBoundedTransaction({
      client: fixture.sql,
      maxConnections: 10,
      now: performance.now,
    });
    const held = run(async (tx) => {
      await lockMediaRound(tx, roundId, seat.actorId);
      entered.resolve();
      await release.promise;
    });
    const attemptId = createId();
    try {
      await entered.promise;
      const marker = await sqlStateOf(() =>
        fixture.sql.begin(async (tx) => {
          await tx`set local lock_timeout='150ms'`;
          await tx`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,backend_pid,backend_started_at)
          values (${attemptId},${createId()},${roundId},${'a'.repeat(64)},${seat.actorId},pg_backend_pid(),(select backend_start from pg_stat_activity where pid=pg_backend_pid()))`;
        }),
      );
      const writer = await sqlStateOf(() =>
        fixture.sql.begin(async (tx) => {
          await tx`set local lock_timeout='150ms'`;
          await tx`update rounds set version=version+1 where id=${roundId}`;
        }),
      );
      const deleting = await sqlStateOf(() =>
        fixture.sql.begin(async (tx) => {
          await tx`set local lock_timeout='150ms'`;
          await tx`delete from rounds where id=${roundId}`;
        }),
      );
      assert({
        given: 'a live media authority lock on the immutable Round key',
        should:
          'allow a visible pending marker while retaining writer and delete exclusion',
        actual: {
          marker,
          writer,
          deleting,
          visible: await fixture.count(
            'round_check_in_attempts',
            'attempt_id',
            attemptId,
          ),
        },
        expected: {
          marker: 'accepted',
          writer: '55P03',
          deleting: '55P03',
          visible: 1,
        },
      });
    } finally {
      release.resolve();
      await held;
      await fixture.sql.unsafe(
        "update round_check_in_attempts set state='aborted',resolved_at=clock_timestamp() where attempt_id=$1",
        [attemptId],
      );
      await fixture.sql.unsafe(
        'delete from round_check_in_attempts where attempt_id=$1',
        [attemptId],
      );
    }
  });
});
