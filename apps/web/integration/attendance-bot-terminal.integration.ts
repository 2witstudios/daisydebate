import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { ordinaryMaintenance } from './round-maintenance.test-support';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import { seedSettledAttendanceLedger } from './round-attendance-fixture.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a bot Round whose worker never returns after its windows are decided still reaches one durable terminal', async () =>
  withRoomRuntime(async (f) => {
    const { roundId, claim } = await ownSpeech(f);
    const instances = [createId(), createId()];
    const renew = () =>
      Promise.all(
        instances.map((instanceId) =>
          f.store.renewServiceInstance({ instanceId, role: 'web' }),
        ),
      );
    const maintenance = instances.map((instanceId) =>
      ordinaryMaintenance(f.store, instanceId),
    );
    const facts = async () =>
      (
        await f.sql`select status,outcome,
        (select count(*)::int from round_commands where round_id=${roundId} and type='complete') as receipts,
        (select count(*)::int from ballots where round_id=${roundId}) as ballots,
        (select count(*)::int from rating_changes where round_id=${roundId}) as ratings,
        (select count(*)::int from round_bot_publications where round_id=${roundId} and lease_expires_at>clock_timestamp()) as live_leases
        from rounds where id=${roundId}`
      )[0];
    try {
      // The worker dies and never returns; nothing reclaims the seat.
      await f.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '55 seconds' where round_id=${roundId} and round_participant_id=${claim.scope.roundParticipantId}`;
      // Component boundary: rebase the opened Round so the shared clock closes every segment and the cutoff passes.
      await f.sql`update rounds set started_at=started_at-interval '2 hours' where id=${roundId}`;
      await f.sql`update round_segments set started_at=started_at-interval '2 hours' where round_id=${roundId}`;
      await f.sql`update round_speaking_intervals set started_at=started_at-interval '2 hours' where round_id=${roundId}`;
      await renew();
      const frozen = await maintenance[0]!.finalize(roundId);
      // Storage fixture: every adjudicable window was decided while the bot was still present.
      await seedSettledAttendanceLedger(f, roundId);
      await renew();
      await Promise.all(maintenance.map((m) => m.finalize(roundId)));
      const terminal = await facts();
      await renew();
      await maintenance[1]!.finalize(roundId);
      assert({
        given:
          'a dead bot worker that never returns, every window decided, and two maintenance instances racing then replaying',
        should:
          'freeze and complete once with no winner, ballot or rating, without any live worker',
        actual: {
          frozen: frozen.status,
          terminal,
          replayed: await facts(),
        },
        expected: {
          frozen: 'frozen',
          terminal: {
            status: 'completed',
            outcome: null,
            receipts: 1,
            ballots: 0,
            ratings: 0,
            live_leases: 0,
          },
          replayed: {
            status: 'completed',
            outcome: null,
            receipts: 1,
            ballots: 0,
            ratings: 0,
            live_leases: 0,
          },
        },
      });
    } finally {
      for (const instanceId of instances)
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }, botControlOptions));
