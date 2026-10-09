import { assert, setupRitewayBun, test } from 'riteway/bun';
import { bindAuthorizationAgeFact } from './authorization-age-reader';
import type { AuthorizationTransaction } from './authorization';
setupRitewayBun();
test('bound minimal age reader uses only its caller transaction', async () => {
  let calls = 0;
  const tx = {
    execute: async () => {
      calls += 1;
      return [];
    },
  } as unknown as AuthorizationTransaction;
  const account = {
    userId: 'a'.repeat(24),
    actorId: 'b'.repeat(24),
    member: true,
    erased: false,
    revision: 1,
  };
  const read = bindAuthorizationAgeFact(tx);
  const now = '2026-10-09T00:00:00.000Z';
  assert({
    given: 'a fenced human account and two ineligible account projections',
    should: 'use the caller transaction only for the bound current account',
    actual: [
      await read(account, now),
      await read({ ...account, actorId: null }, now),
      await read({ ...account, erased: true }, now),
      calls,
    ],
    expected: [
      { state: 'unknown' },
      { state: 'unknown' },
      { state: 'unknown' },
      1,
    ],
  });
});
