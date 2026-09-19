import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { redisKey } from './index';

setupRitewayBun();

describe('redisKey', () => {
  test('namespace is explicit and unambiguous', () => {
    assert({
      given: 'a namespace, domain and segment',
      should: 'compose the versioned key',
      actual: redisKey('daisy', 'presence', 'user-1'),
      expected: 'daisy:v1:presence:user-1',
    });
    expect(() => redisKey('daisy', 'a:b')).toThrow();
  });
});
