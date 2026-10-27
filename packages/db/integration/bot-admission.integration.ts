import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createRoundBotAdmission } from '../src/round-bot-admission';
import {
  admissionSponsor,
  betaAllowance,
  testBotAdmission,
} from './bot-admission.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('the flat beta cap admits the 20th AI Round and refuses the 21st under concurrency', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const roundIds = [firstRound];
    for (let index = 0; index < 20; index++)
      roundIds.push(await fixture.round());
    const actorId = await admissionSponsor(fixture, roundIds);
    const admission = testBotAdmission(run, 21);
    const initial = await admission.readStatus(actorId);
    assert({
      given: 'an approved beta host before any AI Round this month',
      should: 'read the trusted cap of 20 for the exact UTC calendar month',
      actual: initial,
      expected: {
        ...initial,
        limit: 20,
        remaining: 20,
        refusal: null,
      },
    });
    for (const roundId of roundIds.slice(0, 19))
      await admission.reserve({ actorId, roundId });
    const boundary = roundIds.slice(19);
    const attempts = await Promise.allSettled(
      boundary.map((roundId) => admission.reserve({ actorId, roundId })),
    );
    const exhausted = await admission.readStatus(actorId);
    const [{ n }] =
      await fixture.sql`select count(*)::int as n from usage_reservations where actor_id=${actorId}`;
    assert({
      given: '19 reservations and two concurrent requests at the cap',
      should:
        'reserve exactly 20 and show the exhausted allowance, with no grant or caller entitlement',
      actual: [
        attempts.map((a) => a.status).sort(),
        n,
        exhausted.remaining,
        exhausted.refusal,
      ],
      expected: [['fulfilled', 'rejected'], 20, 0, 'allowance'],
    });
  });
});

test('only an approved beta host is eligible, re-read inside each admission', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const secondRound = await fixture.round();
    const pendingRound = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound, secondRound]);
    const pending = await admissionSponsor(fixture, [pendingRound], 'pending');
    const admission = testBotAdmission(run);
    const pendingStatus = await admission.readStatus(pending);
    assert({
      given: 'a pending beta account',
      should: 'show no AI rounds and say why, not that the allowance is spent',
      actual: [
        pendingStatus.limit,
        pendingStatus.remaining,
        pendingStatus.refusal,
      ],
      expected: [0, 0, 'not-eligible'],
    });
    await assertRejects({
      given: 'a pending beta account starting a bot Round',
      should: 'refuse admission without a reservation',
      actual: () =>
        admission.reserve({ actorId: pending, roundId: pendingRound }),
      code: 'CONFLICT',
    });
    await admission.reserve({ actorId, roundId: firstRound });
    await fixture.sql`update account_beta_access set state='revoked', revision=revision+1
      where user_id=(select user_id from actors where id=${actorId})`;
    await assertRejects({
      given: 'a host whose beta approval was revoked mid-month',
      should: 'refuse the next admission from the freshly locked account fact',
      actual: () => admission.reserve({ actorId, roundId: secondRound }),
      code: 'CONFLICT',
    });
    const [{ n }] =
      await fixture.sql`select count(*)::int as n from usage_reservations where actor_id in (${actorId}, ${pending})`;
    assert({
      given: 'the refused admissions',
      should: 'leave only the reservation admitted while approved',
      actual: n,
      expected: 1,
    });
  });
});

test('the month boundary counts only reservations made in the current UTC month', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const earlier = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound, earlier]);
    const [{ start }] =
      await fixture.sql`select date_trunc('month', clock_timestamp() at time zone 'UTC') at time zone 'UTC' as start`;
    await fixture.insert('usage_reservations', {
      id: createId(),
      actor_id: actorId,
      round_id: earlier,
      kind: 'ai_round',
      reserved_at: new Date(start.getTime() - 1),
      counted_at: new Date(start.getTime() - 1),
    });
    const admission = testBotAdmission(run, 4, 1);
    const status = await admission.readStatus(actorId);
    const reservation = await admission.reserve({
      actorId,
      roundId: firstRound,
    });
    const [row] =
      await fixture.sql`select reserved_at from usage_reservations where id=${reservation.id}`;
    assert({
      given:
        'a counted reservation one millisecond before this UTC month and a cap of 1',
      should:
        'exclude it from this month, admit one, and date the reservation inside the selected month',
      actual: [
        status.periodStart === start.toISOString(),
        status.remaining,
        row.reserved_at.getTime() >= start.getTime(),
      ],
      expected: [true, 1, true],
    });
  });
});

test('actual global capacity fails closed', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const secondRound = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound]);
    const otherActor = await admissionSponsor(fixture, [secondRound]);
    const admission = testBotAdmission(run, 1);
    await admission.reserve({ actorId, roundId: firstRound });
    await assertRejects({
      given:
        'another approved host with allowance but one occupied global slot',
      should: 'refuse capacity without guessing settings',
      actual: () =>
        admission.reserve({ actorId: otherActor, roundId: secondRound }),
      code: 'CONFLICT',
    });
    assert({
      given: 'invalid capacity configuration',
      should: 'refuse factory construction',
      actual: [0, -1, NaN, Infinity, 1.1].every((busyCap) => {
        try {
          createRoundBotAdmission({
            run,
            nextId: createId,
            busyCap,
            ...betaAllowance(),
          });
          return false;
        } catch {
          return true;
        }
      }),
      expected: true,
    });
  });
});
