import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  isReportedCapacityRefusal,
  isTransactionCapacityRefusal,
  markCapacityRefusalReported,
  refuseCapacity,
} from './transaction-admission';

setupRitewayBun();

test('capacity identity survives native error wrappers without trusting messages or codes', () => {
  const refusal = refuseCapacity();
  const driver = new Error('Query failed', { cause: refusal });
  const wrapped = createAppError('INFRASTRUCTURE', undefined, driver);
  const cyclic = new Error('cycle');
  Object.assign(cyclic, { cause: cyclic });
  const accessor = Object.defineProperty(new Error('accessor'), 'cause', {
    get: () => {
      throw new Error('must not read a getter');
    },
  });
  assert({
    given:
      'a real refusal, native driver/application wrappers, lookalikes, a cycle and an accessor',
    should:
      'recognize only the refusal and its data-property cause chain, without invoking accessors',
    actual: [
      refusal,
      driver,
      wrapped,
      createAppError('INFRASTRUCTURE', refusal.message),
      new Error('Transcript transaction budget exceeded'),
      { cause: refusal },
      cyclic,
      accessor,
      undefined,
    ].map(isTransactionCapacityRefusal),
    expected: [true, true, true, false, false, false, false, false, false],
  });
});

test('unsupported cause chains never suppress ordinary failure reporting', () => {
  const refusal = refuseCapacity();
  let tooDeep: Error = refusal;
  for (let depth = 0; depth < 16; depth += 1)
    tooDeep = new Error('wrapper', { cause: tooDeep });
  const hostile = new Proxy(new Error('hostile'), {
    getOwnPropertyDescriptor: () => {
      throw new Error('inspection refused');
    },
  });
  const recovering = createAppError('INFRASTRUCTURE', undefined, {
    recovery: 'pending',
    cause: refusal,
  });
  assert({
    given:
      'an excessive cause chain, a hostile proxy and post-execution recovery detail',
    should: 'leave each on the ordinary failure path',
    actual: [tooDeep, hostile, recovering].map(isTransactionCapacityRefusal),
    expected: [false, false, false],
  });
});

test('a reported refusal stays reported under any other wrapper of the same refusal', () => {
  const refusal = refuseCapacity();
  markCapacityRefusalReported(new Error('logged wrapper', { cause: refusal }));
  assert({
    given:
      'a refusal marked reported through one wrapper, then seen through a different wrapper',
    should: 'recognise it as already reported',
    actual: isReportedCapacityRefusal(
      new Error('rethrown wrapper', { cause: refusal }),
    ),
    expected: true,
  });
});
