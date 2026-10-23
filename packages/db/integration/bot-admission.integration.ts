import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createRoundBotAdmission } from '../src/round-bot-admission';
import {
  admissionSponsor,
  withTwoRoundAdmission,
} from './bot-admission.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('calendar-month allowance serializes actual reservations', async () => {
  await withTwoRoundAdmission(
    async ({ firstRound, secondRound, actorId, admission }) => {
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
    },
  );
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
