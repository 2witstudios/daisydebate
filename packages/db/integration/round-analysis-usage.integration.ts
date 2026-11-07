import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import {
  completedRound,
  withCompletedRound,
} from './round-analysis.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('concurrent free requests admit only one original reservation and counted unknown service prevents another use', async () =>
  withCompletedRound(
    async ({ fixture, aff, seats, jobs, request }) => {
      const otherRound = await fixture.round();
      const other = await completedRound(
        fixture,
        otherRound,
        true,
        undefined,
        aff.actorId,
      );
      const candidates = [
        seats.aff,
        { roundId: otherRound, roundParticipantId: other.aff.id },
      ];
      const result = await Promise.allSettled(candidates.map(request));
      assert({
        given: 'two simultaneous free requests by the same account',
        should: 'admit one and refuse the other without duplicate usage',
        actual: [
          result.filter((r) => r.status === 'fulfilled').length,
          result.filter((r) => r.status === 'rejected').length,
          (
            await fixture.sql`select count(*)::integer as n from usage_reservations where actor_id=${aff.actorId} and kind='round_analysis'`
          )[0].n,
        ],
        expected: [1, 1, 1],
      });
      const seat =
        candidates[result.findIndex((r) => r.status === 'fulfilled')]!;
      const first = await jobs.claim(seat);
      if (!first) throw Error('Expected first claim');
      await jobs.dispatch(seat, first.callId, first.token);
      await jobs.observe(seat, first.callId, first.token, {
        kind: 'received',
        inputTokens: 10,
        outputTokens: 2,
      });
      await jobs.retry(seat, first.callId, first.token);
      const second = await jobs.claim(seat);
      if (!second) throw Error('Expected second claim');
      await jobs.dispatch(seat, second.callId, second.token);
      await jobs.retry(seat, second.callId, second.token);
      const [row] =
        await fixture.sql`select source,state from usage_reservations where round_id=${seat.roundId} and kind='round_analysis'`;
      assert({
        given:
          'received invalid report service followed by an unresolved second call',
        should:
          'keep original lifetime attribution and unknown aggregate exposure with no further dispatch',
        actual: [row.source, row.state.kind, await jobs.claim(seat)],
        expected: [{ kind: 'lifetime' }, 'unknown', null],
      });
      await assertRejects({
        given:
          'the other seat after pending work ends but lifetime service remains spent',
        should: 'refuse a second free use',
        code: 'CONFLICT',
        actual: () =>
          request(candidates.find((candidate) => candidate !== seat)!),
      });
      await jobs.observe(seat, second.callId, second.token, {
        kind: 'definite_failure',
      });
      assert({
        given: 'late definite failure for only the second call',
        should:
          'resolve to delivered without refunding the earlier received service',
        actual: (
          await fixture.sql`select state from usage_reservations where round_id=${seat.roundId} and kind='round_analysis'`
        )[0].state.kind,
        expected: 'delivered',
      });
    },
    { betaGrantsPremium: false },
  ));

test('all definite failures restore one original requested use once and never reopen the exhausted seat', async () =>
  withCompletedRound(
    async ({ fixture, seats, jobs, request }) => {
      await request(seats.aff);
      const [original] =
        await fixture.sql`select id,source,reserved_at from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`;
      const claims = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const claim = await jobs.claim(seats.aff);
        if (!claim) throw Error('Expected bounded call');
        claims.push(claim);
        await jobs.dispatch(seats.aff, claim.callId, claim.token);
        await jobs.observe(seats.aff, claim.callId, claim.token, {
          kind: 'definite_failure',
        });
        await jobs.retry(seats.aff, claim.callId, claim.token);
      }
      const [restored] =
        await fixture.sql`select id,source,reserved_at,state from usage_reservations where id=${original.id}`;
      await Promise.all(
        claims.map((claim) =>
          jobs.observe(seats.aff, claim.callId, claim.token, {
            kind: 'definite_failure',
          }),
        ),
      );
      const [replayed] =
        await fixture.sql`select id,source,reserved_at,state from usage_reservations where id=${original.id}`;
      assert({
        given:
          'all two dispatched calls prove nonservice, then duplicate concurrent outcomes arrive',
        should:
          'preserve original source/count and exactly one refund with terminal request identity',
        actual: [
          restored.state.kind,
          {
            id: restored.id,
            source: restored.source,
            reserved_at: restored.reserved_at,
          },
          replayed,
          (await request(seats.aff)).kind,
          await jobs.claim(seats.aff),
        ],
        expected: ['refunded', original, restored, 'failed', null],
      });
    },
    { betaGrantsPremium: false },
  ));

test('bounded nondispatch retries release unspent usage without inventing a call or restarting identity', async () =>
  withCompletedRound(async ({ fixture, seats, jobs, request, aff, facts }) => {
    await request(seats.aff);
    for (let attempt = 0; attempt < 4; attempt++) {
      const claim = await jobs.claim(seats.aff);
      if (!claim) throw Error('Expected bounded claim');
      await jobs.retry(seats.aff, claim.callId, claim.token);
    }
    const state = (await facts(aff)).analysis;
    const [usage] =
      await fixture.sql`select state from usage_reservations where round_id=${seats.aff.roundId} and kind='round_analysis'`;
    assert({
      given: 'four claims proven not dispatched',
      should:
        'stop retrying, release the original reservation and never reset its claims',
      actual: [
        state?.kind,
        state && 'claims' in state ? state.claims : null,
        state && 'calls' in state ? state.calls : null,
        usage.state.kind,
        'countedAt' in usage.state,
        await jobs.claim(seats.aff),
        (await request(seats.aff)).kind,
      ],
      expected: ['failed', 4, [], 'released', false, null, 'failed'],
    });
  }));

test('feature capacity bounds concurrent accounts independently of unused allowance', async () =>
  withCompletedRound(
    async ({ seats, request, fixture, roundId }) => {
      const result = await Promise.allSettled([
        request(seats.aff),
        request(seats.neg),
      ]);
      assert({
        given: 'two eligible accounts requesting while feature capacity is one',
        should: 'admit one durable job and one reservation',
        actual: [
          result.filter((r) => r.status === 'fulfilled').length,
          await fixture.count('round_analyses', 'round_id', roundId),
          await fixture.count('usage_reservations', 'round_id', roundId),
        ],
        expected: [1, 1, 1],
      });
    },
    { capacity: 1 },
  ));
