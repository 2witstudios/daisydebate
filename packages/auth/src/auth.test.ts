import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requirePermission } from './index';

setupRitewayBun();

describe('requirePermission', () => {
  test('authentication and authorization are distinct explicit boundaries', () => {
    expect(() =>
      requirePermission({ kind: 'anonymous' }, 'debate:create'),
    ).toThrow('Authentication');
    expect(() =>
      requirePermission(
        { kind: 'user', userId: 'u', permissions: [] },
        'debate:create',
      ),
    ).toThrow('Permission');
    let authorized = true;
    try {
      requirePermission(
        { kind: 'service', serviceId: 's', permissions: ['debate:create'] },
        'debate:create',
      );
    } catch {
      authorized = false;
    }
    assert({
      given: 'a service principal holding the required permission',
      should: 'admit the operation',
      actual: authorized,
      expected: true,
    });
  });
});
