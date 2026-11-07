import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { advanceAnalysisWork } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { withCompletedRound } from './round-analysis.test-support';
import { finishedOrBlockedBehind } from '../src/testing';
setupRitewayBun();
requireTestServices(process.env);

test('analysis dispatch samples time after a real Round lock wait crossing its lease expiry', async () =>
  withCompletedRound(
    async ({ fixture, seats, jobs, request }) => {
      await request(seats.aff);
      const claim = await jobs.claim(seats.aff);
      if (!claim) throw Error('Expected live claim');
      const [before] =
        await fixture.sql`select work from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`;
      const holder = await fixture.sql.reserve();
      let pending: ReturnType<typeof jobs.dispatch> | undefined;
      let observed: Promise<unknown> | undefined;
      try {
        await holder`begin`;
        await holder`select id from rounds where id=${seats.aff.roundId} for update`;
        const [backend] = await holder`select pg_backend_pid() as pid`;
        pending = jobs.dispatch(seats.aff, claim.callId, claim.token);
        observed = Promise.allSettled([pending]);
        const ordering = await finishedOrBlockedBehind(
          pending,
          fixture.sql,
          Number(backend.pid),
          { now: performance.now, deadlineMs: 300 },
        );
        const [edge] =
          await holder`select clock_timestamp()<(work->'lease'->>'expiresAt')::timestamptz as before from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`;
        assert({
          given: 'a dispatched-attempt admission waiting for its Round',
          should: 'reach the held lock while the unchanged lease is valid',
          actual: [ordering, edge.before],
          expected: ['blocked', true],
        });
        await holder`select pg_sleep(greatest(0,extract(epoch from (work->'lease'->>'expiresAt')::timestamptz-clock_timestamp()))+0.01) from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`;
        await holder`commit`;
        await observed;
        const [after] =
          await fixture.sql`select work from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`;
        const [usage] =
          await fixture.sql`select state from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`;
        assert({
          given: 'the lease expires during the actual lock wait',
          should:
            'refuse without recording a call or debit and retain exactly the old state',
          actual: [await pending, after, usage.state],
          expected: [null, before, { kind: 'reserved' }],
        });
        const replacement = await jobs.claim(seats.aff);
        if (!replacement) throw Error('Expected bounded recovery claim');
        assert({
          given: 'a fresh replacement lease',
          should: 'refuse the stale token and permit only the new claim',
          actual: [
            await jobs.dispatch(seats.aff, claim.callId, claim.token),
            await jobs.dispatch(
              seats.aff,
              replacement.callId,
              replacement.token,
            ),
          ],
          expected: [null, true],
        });
      } finally {
        await holder`rollback`;
        holder.release();
        await observed;
      }
    },
    { leaseMs: 600 },
  ));

test('actual evidence deletion after claim refuses dispatch and releases only a proven unspent reservation', async () =>
  withCompletedRound(async ({ fixture, seats, jobs, request }) => {
    await request(seats.aff);
    const claim = await jobs.claim(seats.aff);
    if (!claim) throw Error('Expected claim');
    await fixture.sql`delete from utterances where round_id=${seats.aff.roundId}`;
    assert({
      given: 'actual retained evidence disappears after claim',
      should:
        'stop before provider dispatch and preserve terminal identity with unspent release',
      actual: [
        await jobs.dispatch(seats.aff, claim.callId, claim.token),
        (
          await fixture.sql`select state from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`
        )[0].state.kind,
        (await request(seats.aff)).kind,
      ],
      expected: [null, 'released', 'failed'],
    });
  }));

test('worker outage beyond the fixed request deadline releases undispatched work without reopening its identity', async () =>
  withCompletedRound(
    async ({ fixture, aff, seats, jobs, request }) => {
      const [clock] = await fixture.sql`select clock_timestamp() as now`;
      const requestedAt = new Date(
        clock.now.getTime() - 16 * 60_000,
      ).toISOString();
      const decision = advanceAnalysisWork(
        null,
        {
          kind: 'request',
          requestId: createId(),
          evidenceLines: 2,
        },
        { now: requestedAt, authorized: true, evidenceAvailable: true },
      );
      if (decision.kind !== 'changed')
        throw Error('Expected valid historical request');
      // Seed a valid admitted queue left untouched during an outage; runtime guards remain enabled.
      await fixture.sql`insert into usage_reservations(id,actor_id,round_id,kind,source,state,reserved_at)
      values (${createId()},${aff.actorId},${seats.aff.roundId},'round_analysis','{"kind":"lifetime"}'::jsonb,'{"kind":"reserved"}'::jsonb,${requestedAt})`;
      await fixture.sql`insert into round_analyses(round_id,round_participant_id,freeze_revision,created_at,work)
      values (${seats.aff.roundId},${seats.aff.roundParticipantId},1,${requestedAt},${JSON.stringify(decision.state)}::text::jsonb)`;
      const discovered = await jobs.scan(64);
      const claim = await jobs.claim(seats.aff);
      const [after] =
        await fixture.sql`select work from round_analyses where round_participant_id=${seats.aff.roundParticipantId}`;
      const [usage] =
        await fixture.sql`select source,state,reserved_at from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`;
      assert({
        given:
          'a valid queued request beyond its fixed 15-minute execution deadline',
        should:
          'discover and terminalize it without a lease, model call or counted debit',
        actual: [
          discovered.some(
            (s) => s.roundParticipantId === seats.aff.roundParticipantId,
          ),
          claim,
          after.work.kind,
          after.work.reason,
          after.work.calls,
          usage.source,
          usage.state.kind,
          usage.reserved_at.toISOString(),
        ],
        expected: [
          true,
          null,
          'failed',
          'expired',
          [],
          { kind: 'lifetime' },
          'released',
          requestedAt,
        ],
      });
      assert({
        given: 'the same request retried after terminal recovery',
        should:
          'reuse its terminal identity and preserve the same once-only release',
        actual: [
          await request(seats.aff),
          await jobs.claim(seats.aff),
          (
            await fixture.sql`select source,state,reserved_at from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`
          )[0],
        ],
        expected: [after.work, null, usage],
      });
    },
    { betaGrantsPremium: false, completedAgoMs: 20 * 60_000 },
  ));
