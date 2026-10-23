import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { bounded, causeOf } from './bounded-transaction.test-support';

setupRitewayBun();

test('a failed callback rolls back, destroys the writer and preserves app error codes', async () => {
  const conflict = bounded();
  await assertRejects({
    given: 'a callback that throws a CONFLICT app error',
    should: 'rethrow the same code after confirmed rollback',
    actual: () =>
      conflict.run(async () => {
        throw createAppError('CONFLICT', 'stale');
      }),
    code: 'CONFLICT',
  });
  const stray = bounded();
  const mapped = await causeOf(() =>
    stray.run(async () => {
      throw new TypeError('driver detail');
    }),
  );
  assert({
    given: 'a callback that throws a non-app error',
    should:
      'map it to a fixed infrastructure message, destroy the writer and release the confirmed control connection',
    actual: {
      message: mapped?.message,
      cause: (mapped?.cause as Error).message,
      conflict: conflict.reservations,
      stray: stray.reservations,
      terminated: stray.queries.some(({ query }) =>
        query.includes('pg_terminate_backend'),
      ),
    },
    expected: {
      message: 'Transcript transaction failed',
      cause: 'driver detail',
      conflict: { reserved: 2, released: 1, closed: 1 },
      stray: { reserved: 2, released: 1, closed: 1 },
      terminated: true,
    },
  });
});

test('an unconfirmed rollback reports pending recovery with a settlement handle', async () => {
  const { run, reservations } = bounded({ protocol: { absent: false } });
  const failure = await causeOf(() =>
    run(async () => {
      throw createAppError('CONFLICT', 'stale');
    }),
  );
  const cause = failure?.cause as {
    readonly recovery: string;
    readonly settlement: { readonly confirm: () => Promise<boolean> };
  };
  assert({
    given: 'recovery that still observes the writer backend',
    should:
      'refuse with pending recovery and close rather than reuse the control connection',
    actual: {
      message: failure?.message,
      recovery: cause.recovery,
      confirmable: typeof cause.settlement.confirm,
      reservations,
    },
    expected: {
      message: 'Transcript transaction recovery pending',
      recovery: 'pending',
      confirmable: 'function',
      reservations: { reserved: 2, released: 0, closed: 2 },
    },
  });
});

test('a commit the server does not acknowledge is never reported as committed', async () => {
  const { run } = bounded({ protocol: { commit: 'ROLLBACK' } });
  const failure = await causeOf(() => run(async () => 'written'));
  assert({
    given: 'a commit answered with another command tag',
    should: 'refuse with the uncommitted infrastructure error',
    actual: failure?.message,
    expected: 'Transcript transaction did not commit',
  });
});

test('pending recovery settles only on positive confirmation of the exact backend', async () => {
  const protocol = { absent: false };
  const { run, reservations } = bounded({ protocol });
  const failure = await causeOf(() =>
    run(async () => {
      throw createAppError('CONFLICT', 'stale');
    }),
  );
  const { settlement } = failure?.cause as {
    readonly settlement: {
      readonly settled: Promise<string>;
      readonly confirm: () => Promise<boolean>;
    };
  };
  const stillPresent = await settlement.confirm();
  protocol.absent = true;
  const [confirmed, again] = await Promise.all([
    settlement.confirm(),
    settlement.confirm(),
  ]);
  assert({
    given: 'a pending writer first observed present, then observed absent',
    should:
      'refuse to settle on the first check, settle once confirmed and keep only the confirming reservation',
    actual: {
      stillPresent,
      confirmed,
      again,
      settled: await settlement.settled,
      afterSettled: await settlement.confirm(),
      reservations,
    },
    expected: {
      stillPresent: false,
      confirmed: true,
      again: true,
      settled: 'backend-absent',
      afterSettled: true,
      reservations: { reserved: 4, released: 1, closed: 3 },
    },
  });
});
