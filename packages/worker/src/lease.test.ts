import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { holdLease, LeaseEnded, type LeaseRenewal } from './lease';

setupRitewayBun();

const cadence = { renewEveryMs: 100, retryMs: 20, horizonMs: 300 };
const held = <Facts>(facts: Facts): LeaseRenewal<Facts> => ({
  kind: 'held',
  facts,
});

/** Leased work: a step every 50 ms, each ending in a public write through the guard. */
const leasedWork = (
  clock: ReturnType<typeof virtualClock>,
  lease: ReturnType<typeof holdLease<number>>,
  steps: number,
) => {
  const writes: number[] = [];
  const done = (async () => {
    for (let step = 0; step < steps; step += 1) {
      await clock.sleep(50, lease.signal);
      try {
        await lease.guard(async () => {
          writes.push(clock.nowMs());
        });
      } catch (error) {
        return error;
      }
    }
    return null;
  })();
  return { writes, done };
};

test('a lost lease aborts the work before its next public write', async () => {
  const clock = virtualClock();
  let renewals = 0;
  const lease = holdLease({
    waits: clock,
    facts: 0,
    ...cadence,
    renew: async () => {
      renewals += 1;
      return renewals < 2 ? held(renewals) : { kind: 'lost', reason: 'taken' };
    },
    failed: () => undefined,
  });
  const work = leasedWork(clock, lease, 10);
  await clock.advance(1_000);
  const refusal = await work.done;
  assert({
    given:
      'a renewal at 200 that finds the lease taken, during work that writes every 50 ms',
    should:
      'abort the lease signal at 200 and refuse every write from then, never calling it',
    actual: {
      writes: work.writes,
      refusal: refusal instanceof LeaseEnded ? refusal.end : refusal,
      ended: await lease.ended,
      reason: (lease.signal.reason as LeaseEnded).end,
    },
    expected: {
      writes: [50, 100, 150],
      refusal: 'taken',
      ended: 'taken',
      reason: 'taken',
    },
  });
});

test('a renewal blip is not a loss; blips past the horizon are', async () => {
  const clock = virtualClock();
  const failures: string[] = [];
  const attemptsAt: number[] = [];
  // Holds at 100, then fails from 200 on.
  const lease = holdLease({
    waits: clock,
    facts: 'claim',
    ...cadence,
    renew: async () => {
      attemptsAt.push(clock.nowMs());
      if (attemptsAt.length === 1) return held('renewed');
      throw new Error('database blip');
    },
    failed: (error) => failures.push((error as Error).message),
  });
  await clock.advance(350);
  const facts = lease.facts();
  const stillHeld = !lease.signal.aborted;
  const write = await lease.guard(async () => 'written');
  await clock.advance(100);
  assert({
    given: 'one good renewal at 100, then failing renewals retried every 20 ms',
    should:
      'hold, with the last facts, until 300 after the good renewal started, then expire',
    actual: {
      at350: { stillHeld, facts, write },
      ended: await lease.ended,
      endedBy: clock.nowMs() >= 400,
      attemptsAt,
      blips: failures.length,
    },
    expected: {
      at350: { stillHeld: true, facts: 'renewed', write: 'written' },
      ended: 'expired',
      endedBy: true,
      attemptsAt: [100, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380],
      blips: 10,
    },
  });
});

test('a renewal hung past the horizon expires the lease on time and is aborted', async () => {
  const clock = virtualClock();
  let renewSignal: AbortSignal | undefined;
  const lease = holdLease({
    waits: clock,
    facts: null,
    ...cadence,
    renew: (signal) => {
      renewSignal = signal;
      return new Promise<never>(() => undefined);
    },
    failed: () => undefined,
  });
  await clock.advance(299);
  const before = lease.signal.aborted;
  await clock.advance(1);
  assert({
    given: 'a claim at 0 whose first renewal, at 100, never answers',
    should: 'expire at the 300 ms horizon and abort the hung renewal',
    actual: {
      before,
      after: lease.signal.aborted,
      ended: await lease.ended,
      renewAborted: renewSignal?.aborted,
      guard: await lease
        .guard(async () => 'written')
        .catch((error: LeaseEnded) => error.end),
    },
    expected: {
      before: false,
      after: true,
      ended: 'expired',
      renewAborted: true,
      guard: 'expired',
    },
  });
});

test('a thrown refusal mapped as a release ends the lease, not a blip', async () => {
  const clock = virtualClock();
  const failures: unknown[] = [];
  const lease = holdLease({
    waits: clock,
    facts: null,
    ...cadence,
    renew: async () => {
      throw Object.assign(new Error('Judging lease changed'), {
        code: 'CONFLICT',
      });
    },
    lossOf: (error) =>
      (error as { code?: string }).code === 'CONFLICT' ? 'released' : null,
    failed: (error) => failures.push(error),
  });
  await clock.advance(100);
  assert({
    given:
      'a renewal refused with CONFLICT, which this store means as completion',
    should: 'end the lease as released at once and report nothing',
    actual: { ended: await lease.ended, failures: failures.length },
    expected: { ended: 'released', failures: 0 },
  });
});

test('a throwing failure sink is contained', async () => {
  const clock = virtualClock();
  let attempts = 0;
  const lease = holdLease({
    waits: clock,
    facts: null,
    ...cadence,
    renew: async () => {
      attempts += 1;
      throw new Error('blip');
    },
    failed: () => {
      throw new Error('the reporter is down too');
    },
  });
  await clock.advance(200);
  await lease.stop();
  assert({
    given: 'blips reported to a sink that throws',
    should: 'keep retrying',
    actual: attempts,
    expected: 6,
  });
});

test('stop aborts the renewal in flight, awaits it, and releases only when asked', async () => {
  const clock = virtualClock();
  const released: string[] = [];
  let renewAborted = false;
  const start = (name: string) =>
    holdLease({
      waits: clock,
      facts: null,
      ...cadence,
      renew: (signal) =>
        new Promise<LeaseRenewal<null>>((resolve) => {
          signal.addEventListener('abort', () => {
            renewAborted = true;
            resolve(held(null));
          });
        }),
      failed: () => undefined,
      release: async () => {
        released.push(name);
      },
    });
  const kept = start('kept');
  const handedBack = start('handed back');
  await clock.advance(150);
  await kept.stop();
  await handedBack.stop({ release: true });
  const lost = holdLease({
    waits: clock,
    facts: null,
    ...cadence,
    renew: async () => ({ kind: 'lost', reason: 'taken' }),
    failed: () => undefined,
    release: async () => {
      released.push('lost');
    },
  });
  await clock.advance(100);
  await lost.stop({ release: true });
  assert({
    given:
      'two leases stopped while a renewal is in flight, one asked to release, and one already lost',
    should:
      'abort the renewal, end both as stopped, release only the one asked, and never release a lost lease',
    actual: {
      renewAborted,
      kept: await kept.ended,
      released,
      lost: await lost.ended,
      sleepers: clock.sleepers(),
    },
    expected: {
      renewAborted: true,
      kept: 'stopped',
      released: ['handed back'],
      lost: 'taken',
      sleepers: 0,
    },
  });
});

test('a held renewal carries the store facts forward', async () => {
  const clock = virtualClock();
  let revision = 0;
  const lease = holdLease({
    waits: clock,
    facts: { revision: 0, stopping: false },
    ...cadence,
    renew: async () => {
      revision += 1;
      return held({ revision, stopping: revision === 3 });
    },
    failed: () => undefined,
  });
  await clock.advance(250);
  const midway = lease.facts();
  await clock.advance(100);
  const later = lease.facts();
  await lease.stop();
  assert({
    given: 'renewals that return the job row',
    should: 'expose the latest row to the work',
    actual: { midway, later },
    expected: {
      midway: { revision: 2, stopping: false },
      later: { revision: 3, stopping: true },
    },
  });
});

test('a cadence that cannot renew before expiry is refused', () => {
  let error: unknown;
  try {
    holdLease({
      waits: virtualClock(),
      facts: null,
      renewEveryMs: 300,
      retryMs: 20,
      horizonMs: 300,
      renew: async () => held(null),
      failed: () => undefined,
    });
  } catch (caught) {
    error = caught;
  }
  assert({
    given: 'a renewal every 300 ms on a 300 ms horizon',
    should: 'refuse it',
    actual: (error as Error | undefined)?.message,
    expected: 'Invalid lease cadence',
  });
});
