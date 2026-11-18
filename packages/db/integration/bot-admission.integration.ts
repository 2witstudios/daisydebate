import { judgedRound } from './judged-round.test-support';
import { sql } from 'drizzle-orm';
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
import { createBotActor, createBotSeat } from './bot-seat.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('the per-day fair-use ceiling admits the 12th bot Round and refuses the 13th under concurrency', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const roundIds = [firstRound];
    for (let index = 0; index < 12; index++)
      roundIds.push(await fixture.round());
    const actorId = await admissionSponsor(fixture, roundIds);
    const admission = testBotAdmission(run, 13);
    const initial = await admission.readStatus(actorId);
    assert({
      given: 'an approved Premium-beta host before any bot Round today',
      should: 'read only that a bot Round can start: no count, limit or period',
      actual: initial,
      expected: { refusal: null },
    });
    for (const roundId of roundIds.slice(0, 11))
      await admission.reserve({ actorId, roundId });
    const boundary = roundIds.slice(11);
    const attempts = await Promise.allSettled(
      boundary.map((roundId) => admission.reserve({ actorId, roundId })),
    );
    const exhausted = await admission.readStatus(actorId);
    const [{ n }] =
      await fixture.sql`select count(*)::int as n from usage_reservations where actor_id=${actorId}`;
    assert({
      given: '11 reservations today and two concurrent requests at the ceiling',
      should:
        'reserve exactly 12 and read the abuse ceiling, with no grant or caller entitlement',
      actual: [attempts.map((a) => a.status).sort(), n, exhausted],
      expected: [['fulfilled', 'rejected'], 12, { refusal: 'abuse-ceiling' }],
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
      should: 'say why, not that an allowance is spent, and carry no count',
      actual: pendingStatus,
      expected: { refusal: 'not-eligible' },
    });
    await assertRejects({
      given: 'a pending beta account starting a bot Round',
      should: 'refuse admission without a reservation',
      actual: () =>
        admission.reserve({ actorId: pending, roundId: pendingRound }),
      code: 'CONFLICT',
    });
    await admission.reserve({ actorId, roundId: firstRound });
    // As the beta access command does: revocation removes the beta grants.
    await fixture.sql`update account_beta_access set state='revoked', revision=revision+1
      where user_id=(select user_id from actors where id=${actorId})`;
    await fixture.sql`delete from account_entitlement_grants
      where source='beta' and user_id=(select user_id from actors where id=${actorId})`;
    await assertRejects({
      given: 'a host whose beta approval and its grants were revoked mid-month',
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

test('the day boundary counts only reservations made in the current UTC day', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const earlier = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound, earlier]);
    const [{ start }] =
      await fixture.sql`select date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC' as start`;
    const before = new Date(start.getTime() - 1);
    await fixture.insert('usage_reservations', {
      id: createId(),
      actor_id: actorId,
      round_id: earlier,
      kind: 'ai_round',
      reserved_at: before,
      source: {
        kind: 'beta',
        startsAt: new Date(
          Date.UTC(before.getUTCFullYear(), before.getUTCMonth(), 1),
        ).toISOString(),
        endsAt: new Date(
          Date.UTC(before.getUTCFullYear(), before.getUTCMonth() + 1, 1),
        ).toISOString(),
      },
      state: {
        kind: 'unknown',
        countedAt: before.toISOString(),
        countBasis: 'dispatch_record',
      },
    });
    const admission = testBotAdmission(run, 4, 1);
    const status = await admission.readStatus(actorId);
    const reservation = await admission.reserve({
      actorId,
      roundId: firstRound,
    });
    const after = await admission.readStatus(actorId);
    const [row] =
      await fixture.sql`select reserved_at from usage_reservations where id=${reservation.id}`;
    assert({
      given:
        'a counted bot Round one millisecond before this UTC day and a daily ceiling of 1',
      should:
        'leave it out of today, admit one dated today, then read the ceiling',
      actual: [
        status.refusal,
        row.reserved_at.getTime() >= start.getTime(),
        after.refusal,
      ],
      expected: [null, true, 'abuse-ceiling'],
    });
  });
});

test('actual global capacity fails closed', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const secondRound = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound]);
    const otherActor = await admissionSponsor(fixture, [secondRound]);
    const admission = testBotAdmission(run, 1);
    await createBotSeat(fixture, firstRound, 'negative');
    await admission.reserve({ actorId, roundId: firstRound });
    await assertRejects({
      given:
        'another approved host with allowance but one occupied global slot',
      should:
        'refuse capacity without guessing settings, as the bots-busy room refusal',
      actual: () =>
        admission.reserve({ actorId: otherActor, roundId: secondRound }),
      code: 'CONFLICT',
      reason: 'bots-busy',
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

test('capacity counts live bot-debater Rounds, not reservations (ISSUE-773)', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const judged = await judgedRound(fixture);
    const finished = await fixture.round();
    const unseated = await fixture.round();
    const refused = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound, refused]);
    await createBotSeat(fixture, judged, 'judge');
    await createBotSeat(fixture, finished, 'negative');
    await fixture.sql`update rounds set status='completed',started_at=${new Date('2026-10-22T10:00:00.000Z')},completed_at=${new Date('2026-10-22T10:01:00.000Z')},current_stage=null,winning_side=null where id=${finished}`;
    const admission = testBotAdmission(run, 1);
    const admitted = await admission.reserve({ actorId, roundId: firstRound });
    assert({
      given:
        'a cap of 1, a live Round whose only bot judges and a completed bot-debater Round',
      should: 'admit: an AI judge and a finished Round take no slot',
      actual: admitted.roundId,
      expected: firstRound,
    });
    await createBotSeat(fixture, unseated, 'affirmative');
    await assertRejects({
      given:
        'a live bot-debater Round holding no reservation, as ranked play leaves it, at a cap of 1',
      should: 'refuse the next AI Round for capacity, as bots-busy',
      actual: () => admission.reserve({ actorId, roundId: refused }),
      code: 'CONFLICT',
      reason: 'bots-busy',
    });
    const status = await admission.readStatus(actorId);
    assert({
      given: 'that live bot-debater Round and one spent AI Round',
      should: 'refuse for capacity while the allowance still has room',
      actual: status,
      expected: { refusal: 'capacity' },
    });
  });
});

test('two bot-debater Rounds racing for the last capacity slot admit exactly one (ISSUE-773)', async () => {
  await withBoundedRound(async (fixture, run, firstRound) => {
    const [second, third] = [await fixture.round(), await fixture.round()];
    const actorId = await admissionSponsor(fixture, [second, third]);
    await createBotSeat(fixture, firstRound, 'negative');
    const bots = [await createBotActor(fixture), await createBotActor(fixture)];
    const admission = testBotAdmission(run, 2);
    // As a Launch freezes: the admission lock, then the Round's bot seat,
    // then the reservation, all in one transaction.
    const launch = (roundId: string, botActor: string) =>
      run(async (tx) => {
        await admission.lock(tx);
        await tx.execute(sql`insert into round_participants (id, round_id, actor_id, seat_kind, side, slot)
          values (${createId()}, ${roundId}, ${botActor}, 'side', 'negative', 0)`);
        return admission.reserveLocked(tx, { actorId, roundId });
      });
    const attempts = await Promise.allSettled([
      launch(second, bots[0]!),
      launch(third, bots[1]!),
    ]);
    const [{ n }] =
      await fixture.sql`select count(*)::int as n from usage_reservations where actor_id=${actorId}`;
    assert({
      given:
        'one live bot-debater Round at a cap of 2 and two more Launches seating a bot and reserving concurrently',
      should:
        'serialize on the bot-admission lock and admit exactly one, with one reservation',
      actual: [attempts.map((a) => a.status).sort(), n],
      expected: [['fulfilled', 'rejected'], 1],
    });
    for (const attempt of attempts)
      if (attempt.status === 'rejected')
        await assertRejects({
          given: 'the Launch that lost the race',
          should: 'refuse it for capacity, as bots-busy',
          actual: () => Promise.reject(attempt.reason),
          code: 'CONFLICT',
          reason: 'bots-busy',
        });
  });
});
