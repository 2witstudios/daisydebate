import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { commandDigest } from '@daisy/digest';

setupRitewayBun();

describe('commandDigest', () => {
  const payload = { expected: { organization: 2 }, command: { type: 'x' } };
  test('a payload', () => {
    assert({
      given: 'a parsed payload',
      should: 'answer 64 lowercase hex, as action history stores it',
      actual: /^[0-9a-f]{64}$/.test(commandDigest(payload)),
      expected: true,
    });
  });
  test('the same and another payload', () => {
    assert({
      given: 'the same payload twice and a changed one',
      should: 'digest the same payload the same and the changed one apart',
      actual: [
        commandDigest(payload) === commandDigest({ ...payload }),
        commandDigest(payload) ===
          commandDigest({ ...payload, expected: { organization: 3 } }),
      ],
      expected: [true, false],
    });
  });
});
