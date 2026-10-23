import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { nextEpoch, requireLeaseMs } from './lease-policy';

setupRitewayBun();

test('worker leases are whole milliseconds from 1ms to one minute', async () => {
  assert({
    given: 'the shortest and longest admitted leases',
    should: 'admit both',
    actual: [requireLeaseMs(1), requireLeaseMs(60000)],
    expected: [undefined, undefined],
  });
  for (const leaseMs of [0, 60001, 1.5, Number.NaN, -1])
    await assertRejects({
      given: `a ${leaseMs}ms lease`,
      should: 'refuse the worker configuration',
      actual: () => requireLeaseMs(leaseMs),
      code: 'VALIDATION',
    });
});

test('fencing epochs advance by one and refuse to pass the integer column', async () => {
  assert({
    given: 'no prior epoch and the last representable predecessor',
    should: 'advance by exactly one',
    actual: [nextEpoch(0, 'exhausted'), nextEpoch(2147483646, 'exhausted')],
    expected: [1, 2147483647],
  });
  await assertRejects({
    given: 'an epoch already at the PostgreSQL integer maximum',
    should: 'refuse rather than wrap or overflow',
    actual: () => nextEpoch(2147483647, 'exhausted'),
    code: 'CONFLICT',
  });
});
