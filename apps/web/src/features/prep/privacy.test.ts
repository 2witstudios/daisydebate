import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { privacyPromises, privacyRows } from './privacy';

setupRitewayBun();

describe('privacy copy', () => {
  test('three promises and seven rows of three columns', () => {
    assert({
      given: 'the privacy content',
      should: 'have three promises and seven complete rows',
      actual: [
        privacyPromises.length,
        privacyRows.length,
        privacyRows.every((row) => row.every((cell) => cell !== '')),
      ],
      expected: [3, 7, true],
    });
  });

  test('no internal classification vocabulary leaks to users', () => {
    const text = JSON.stringify([privacyPromises, privacyRows]);
    assert({
      given: 'the copy shown to users',
      should: 'not mention ADRs or data categories',
      actual: /ADR|personal ·|classification/i.test(text),
      expected: false,
    });
  });
});
