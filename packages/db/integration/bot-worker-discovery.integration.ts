import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createBotSeat } from './bot-seat.test-support';
import { withBotPublication } from './bot-publication.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('durable discovery recovers idle controllers without granting publication', async () => {
  await withBotPublication(async ({ fixture, target, operations }) => {
    await createBotSeat(fixture, target.roundId, 'judge');
    const own = async () =>
      (await operations.scanWorkers(64)).filter(
        (candidate) => candidate.roundId === target.roundId,
      );
    assert({
      given: 'an active bot debater and assigned bot judge',
      should: 'discover only the debater against its actual latest segment',
      actual: await own(),
      expected: [target],
    });
    const claim = await operations.claimWorker(target);
    assert({
      given: 'a fresh scoped controller',
      should: 'leave discovery until recovery is required',
      actual: await own(),
      expected: [],
    });
    await fixture.sql`update round_segments set ended_at=clock_timestamp() where id=${target.segmentId}`;
    await operations.revoke(claim.scope, claim.token);
    assert({
      given: 'the last actual segment closed and its controller revoked',
      should: 'discover idle control recovery for historical attendance',
      actual: await own(),
      expected: [target],
    });
    const next = await operations.claimWorker(target);
    await assertRejects({
      given: 'a recovered idle controller after the last segment',
      should: 'still refuse new publication',
      actual: () => operations.verifyBotPublication(next.scope, next.token),
      code: 'CONFLICT',
    });
    await fixture.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${target.roundId}`;
    assert({
      given: 'a terminal Round',
      should: 'never discover a new controller',
      actual: await own(),
      expected: [],
    });
  });
});
