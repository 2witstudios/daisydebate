import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { loadAuthorizationAgeFact } from './authorization-age';
import type { AuthorizationTransaction } from './authorization';
setupRitewayBun();
const input = {
  userId: 'a'.repeat(24),
  actorId: 'b'.repeat(24),
  accountRevision: 1,
  now: '2026-10-09T00:00:00.000Z',
};
test('minimal age projection binds the current account and monthly deadline', async () => {
  const fact = {
    state: 'known' as const,
    actorId: input.actorId,
    band: 'adult' as const,
    revision: 2,
    accountRevision: 1,
    validUntil: '2026-11-01T00:00:00.000Z',
  };
  const rows = [
    [],
    [{ ...fact, validUntil: new Date(fact.validUntil), birthMonth: 'private' }],
    [{ ...fact, actorId: 'c'.repeat(24) }],
    [{ ...fact, accountRevision: 2 }],
    [{ ...fact, validUntil: new Date(input.now) }],
    [{ ...fact, band: 'unrecognized' }],
  ];
  const actual = [];
  for (const values of rows) {
    const tx = {
      execute: async () => values,
    } as unknown as AuthorizationTransaction;
    actual.push(await loadAuthorizationAgeFact(tx, input));
  }
  assert({
    given: 'minimal current and invalid producer rows',
    should: 'expose only valid bound age facts and otherwise return unknown',
    actual,
    expected: [
      { state: 'unknown' },
      fact,
      ...Array.from({ length: 4 }, () => ({ state: 'unknown' })),
    ],
  });
});
test('minimal age inputs reject before transaction I/O', async () => {
  const tx = {
    execute: () => {
      throw new Error('I/O must not begin');
    },
  } as unknown as AuthorizationTransaction;
  await assertRejects({
    given: 'a malformed actor binding',
    should: 'refuse before SQL',
    actual: () =>
      loadAuthorizationAgeFact(tx, { ...input, actorId: 'invalid' }),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'a non-string injected timestamp',
    should: 'refuse safely before date parsing or SQL',
    actual: () =>
      loadAuthorizationAgeFact(tx, {
        ...input,
        now: Symbol('invalid') as unknown as string,
      }),
    code: 'VALIDATION',
  });
});
