import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createRoundBotAdmission } from '../src/round-bot-admission';
import {
  admissionSponsor,
  refundAcrossTerminal,
} from './bot-admission.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('calendar-month allowance serializes actual reservations and refunds vendor failure', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const secondRound = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound, secondRound]);
    const admission = createRoundBotAdmission({
      run,
      nextId: createId,
      busyCap: 4,
    });
    const initial = await admission.readStatus(actorId);
    assert({
      given: 'a free member before admission',
      should: 'read the actual current UTC monthly allowance',
      actual: [initial.limit, initial.remaining, initial.refusal],
      expected: [1, 1, null],
    });
    const attempts = await Promise.allSettled([
      admission.reserve({ actorId, roundId: firstRound }),
      admission.reserve({ actorId, roundId: secondRound }),
    ]);
    assert({
      given: 'two actual concurrent reservations by a free member',
      should: 'reserve exactly one monthly allowance',
      actual: attempts.map((a) => a.status).sort(),
      expected: ['fulfilled', 'rejected'],
    });
    const exhausted = await admission.readStatus(actorId);
    assert({
      given: 'an uncounted reservation holding the monthly slot',
      should: 'show the actual exhausted allowance before another freeze',
      actual: [exhausted.remaining, exhausted.refusal],
      expected: [0, 'allowance'],
    });
    const winner = attempts.find((a) => a.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Expected reservation');
    const reservation = winner.value;
    await assertRejects({
      given: 'a reservation with no recorded model call',
      should: 'refuse fabricated vendor-failure refund',
      actual: () => admission.refundVendorFailure(reservation),
      code: 'CONFLICT',
    });
    await admission.markFirstModelCall(reservation);
    await admission.markFirstModelCall(reservation);
    const [before] =
      await fixture.sql`select counted_at,reserved_at,refunded_at from usage_reservations where id=${reservation.id}`;
    assert({
      given: 'the first call of any model kind',
      should: 'count once with real nonfabricated admission provenance',
      actual: [
        before!.counted_at !== null,
        before!.reserved_at !== null,
        before!.refunded_at,
      ],
      expected: [true, true, null],
    });
    await admission.refundVendorFailure(reservation);
    await admission.refundVendorFailure(reservation);
    await admission.reserve({
      actorId,
      roundId: reservation.roundId === firstRound ? secondRound : firstRound,
    });
    await assertRejects({
      given: 'a refunded reservation',
      should: 'refuse redispatch instead of silently charging a second time',
      actual: () => admission.markFirstModelCall(reservation),
      code: 'CONFLICT',
    });
  });
});
test('only a current authoritative grant supplies ten reservations', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const roundIds = [firstRound];
    for (let index = 0; index < 10; index++)
      roundIds.push(await fixture.round());
    const actorId = await admissionSponsor(fixture, roundIds);
    const grant = createId();
    await fixture.insert('ai_allowance_grants', {
      id: grant,
      actor_id: actorId,
      period_start: new Date(Date.now() - 86400000),
      period_end: new Date(Date.now() + 86400000),
    });
    try {
      const admission = createRoundBotAdmission({
        run,
        nextId: createId,
        busyCap: 20,
      });
      for (const roundId of roundIds.slice(0, 9))
        await admission.reserve({ actorId, roundId });
      const boundary = roundIds.slice(9);
      const attempts = await Promise.allSettled(
        boundary.map((roundId) => admission.reserve({ actorId, roundId })),
      );
      assert({
        given:
          'nine reservations and two concurrent requests at the grant boundary',
        should: 'reserve exactly ten without caller supplied premium claims',
        actual: attempts.map((a) => a.status).sort(),
        expected: ['fulfilled', 'rejected'],
      });
      const last =
        boundary[attempts.findIndex((a) => a.status === 'rejected')]!;
      await fixture.sql`update ai_allowance_grants set revoked_at=clock_timestamp() where id=${grant}`;
      await assertRejects({
        given: 'a revoked grant and already spent monthly allowance',
        should: 'fall back to free and refuse escalation',
        actual: () => admission.reserve({ actorId, roundId: last }),
        code: 'CONFLICT',
      });
    } finally {
      await fixture.sql`delete from ai_allowance_grants where id=${grant}`;
    }
  });
});
test('actual global capacity fails closed', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const secondRound = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound]);
    const otherActor = await admissionSponsor(fixture, [secondRound]);
    const admission = createRoundBotAdmission({
      run,
      nextId: createId,
      busyCap: 1,
    });
    await admission.reserve({ actorId, roundId: firstRound });
    await assertRejects({
      given: 'another actor with allowance but one occupied global slot',
      should: 'refuse capacity without granting premium or guessing settings',
      actual: () =>
        admission.reserve({ actorId: otherActor, roundId: secondRound }),
      code: 'CONFLICT',
    });
    assert({
      given: 'invalid capacity configuration',
      should: 'refuse factory construction',
      actual: [0, -1, NaN, Infinity, 1.1].every((busyCap) => {
        try {
          createRoundBotAdmission({ run, nextId: createId, busyCap });
          return false;
        } catch {
          return true;
        }
      }),
      expected: true,
    });
  });
});
for (const terminal of ['abandoned', 'completed'] as const)
  test(`known vendor failure refunds after ${terminal} without competitive mutation`, async () => {
    await withBoundedRound(async (fixture, run, roundId) => {
      const actorId = await admissionSponsor(fixture, [roundId]);
      const admission = createRoundBotAdmission({
        run,
        nextId: createId,
        busyCap: 4,
      });
      const otherRound = await fixture.round();
      const otherActor = await admissionSponsor(fixture, [otherRound]);
      const unrelated = await admission.reserve({
        actorId: otherActor,
        roundId: otherRound,
      });
      await admission.markFirstModelCall(unrelated);
      const [unrelatedBefore] =
        await fixture.sql`select * from usage_reservations where id=${unrelated.id}`;
      const reservation = await admission.reserve({ actorId, roundId });
      await admission.markFirstModelCall(reservation);
      const before = await refundAcrossTerminal(
        fixture,
        roundId,
        terminal,
        () => admission.refundVendorFailure(reservation),
      );
      await admission.refundVendorFailure(reservation);
      await admission.refundVendorFailure(reservation);
      const [after] =
        await fixture.sql`select status,version,outcome,started_at,completed_at from rounds where id=${roundId}`;
      const [unrelatedAfter] =
        await fixture.sql`select * from usage_reservations where id=${unrelated.id}`;
      const [usage] =
        await fixture.sql`select refunded_at,counted_at from usage_reservations where id=${reservation.id}`;
      assert({
        given:
          'a known server vendor failure arriving after the terminal commit',
        should:
          'idempotently settle the recorded reservation and preserve exact competitive state',
        actual: [
          after,
          usage!.refunded_at !== null,
          usage!.counted_at !== null,
          unrelatedAfter,
        ],
        expected: [before, true, true, unrelatedBefore],
      });
      await assertRejects({
        given: 'the same terminal/refunded reservation',
        should: 'grant no new model dispatch',
        actual: () => admission.markFirstModelCall(reservation),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'a foreign reservation identity',
        should: 'refuse refund without altering another record',
        actual: () =>
          admission.refundVendorFailure({ ...reservation, id: unrelated.id }),
        code: 'AUTHORIZATION',
      });
    });
  });
