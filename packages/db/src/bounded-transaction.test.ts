import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBoundedTransaction } from './bounded-transaction';
import { admitsTransaction, runAsBackgroundWork } from './transaction-capacity';
setupRitewayBun();

const admits = (active: number, background: number, backgroundWork: boolean) =>
  admitsTransaction({ maxConnections: 10, active, background, backgroundWork });

test('background work leaves a fixed public reserve of the transaction budget', () => {
  assert({
    given: 'a ten-connection pool (budget five, reserve two)',
    should:
      'admit background work up to three, public work up to five, and nothing past the budget',
    actual: [
      admits(2, 2, true),
      admits(3, 3, true),
      admits(3, 3, false),
      admits(4, 3, false),
      admits(5, 3, false),
      admits(4, 1, true),
    ],
    expected: [true, false, true, true, false, true],
  });
});

test('small or invalid pools stay deterministic', () => {
  assert({
    given:
      'a four-connection pool, a one-connection pool and a non-integer pool',
    should:
      'still admit one background transaction when the budget allows, and refuse invalid pools',
    actual: [
      admitsTransaction({
        maxConnections: 4,
        active: 0,
        background: 0,
        backgroundWork: true,
      }),
      admitsTransaction({
        maxConnections: 4,
        active: 1,
        background: 1,
        backgroundWork: true,
      }),
      admitsTransaction({
        maxConnections: 4,
        active: 1,
        background: 1,
        backgroundWork: false,
      }),
      admitsTransaction({
        maxConnections: 1,
        active: 0,
        background: 0,
        backgroundWork: false,
      }),
      admitsTransaction({
        maxConnections: 2.5,
        active: 0,
        background: 0,
        backgroundWork: false,
      }),
    ],
    expected: [true, false, true, false, false],
  });
});

test('the background class follows continuations and timers and leaves the public reserve usable', async () => {
  const gate = new AbortController();
  // A pool whose reservations wait until the test releases them, so slots stay held.
  const client = {
    reserve: () =>
      new Promise((_, reject) =>
        gate.signal.addEventListener('abort', () => reject(gate.signal.reason)),
      ),
  } as unknown as Parameters<typeof createBoundedTransaction>[0]['client'];
  const run = createBoundedTransaction({
    client,
    maxConnections: 10,
    now: () => 0,
  });
  const work = async () => 'unreached';
  const settled = (attempt: Promise<unknown>) =>
    attempt.then(
      () => 'admitted',
      (error: Error) => error.message,
    );
  const held = [settled(runAsBackgroundWork(() => run(work)))];
  held.push(settled(runAsBackgroundWork(() => run(work))));
  await runAsBackgroundWork(
    () =>
      new Promise<void>((started) =>
        setTimeout(() => {
          held.push(settled(run(work)));
          started();
        }, 0),
      ),
  );
  const refused = await settled(runAsBackgroundWork(() => run(work)));
  // Admitted work reaches the held reservation and ends only when it is released.
  const publicAttempt = settled(run(work));
  gate.abort(new Error('released'));
  const [publicOutcome] = await Promise.all([publicAttempt, ...held]);
  assert({
    given:
      'three held background transactions, one started from a background timer',
    should:
      'refuse a fourth background transaction while a public one is still admitted',
    actual: [refused, publicOutcome === refused],
    expected: ['Transcript transaction capacity unavailable', false],
  });
});
