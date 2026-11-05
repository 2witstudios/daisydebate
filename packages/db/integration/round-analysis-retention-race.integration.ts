import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { withCompletedRound } from './round-analysis.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('concurrent transcript retention cannot race an analysis dispatch through stale visible evidence', async () =>
  withCompletedRound(async ({ fixture, seats, request, jobs }) => {
    await request(seats.aff);
    const claim = await jobs.claim(seats.aff);
    if (!claim) throw Error('Expected claim');
    const read = async () => {
      const [row] =
        await fixture.sql`select a.work,u.state from round_analyses a join round_participants p on p.id=a.round_participant_id join usage_reservations u on u.round_id=a.round_id and u.actor_id=p.actor_id and u.kind='round_analysis' where a.round_participant_id=${seats.aff.roundParticipantId}`;
      return row;
    };
    const before = await read();
    const retention = await fixture.sql.reserve();
    try {
      await retention`begin`;
      await retention`delete from utterances where round_id=${seats.aff.roundId}`;
      await assertRejects({
        given:
          'retention has deleted evidence but has not committed, so a plain snapshot still sees it',
        should:
          'refuse dispatch on the conflicting evidence lock before any call or count',
        actual: () => jobs.dispatch(seats.aff, claim.callId, claim.token),
        code: 'INFRASTRUCTURE',
      });
      assert({
        given: 'the refused dispatch while the retention transaction is open',
        should:
          'leave the entire lease, call history and reserved usage unchanged',
        actual: await read(),
        expected: before,
      });
      await retention`commit`;
      assert({
        given: 'the committed retention followed by the original worker retry',
        should:
          'terminalize with no dispatch and release only the unspent reservation',
        actual: [
          await jobs.dispatch(seats.aff, claim.callId, claim.token),
          (await read()).state.kind,
          (await request(seats.aff)).kind,
        ],
        expected: [null, 'released', 'failed'],
      });
    } finally {
      await retention`rollback`;
      retention.release();
    }
  }));
