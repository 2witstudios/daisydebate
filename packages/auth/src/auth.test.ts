import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requirePermission, type Permission } from './index';

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

  test('debate:read is its own permission, separate from the write permissions', () => {
    const admits = (
      held: readonly Permission[],
      required: Permission,
    ): boolean => {
      try {
        requirePermission(
          { kind: 'service', serviceId: 's', permissions: held },
          required,
        );
        return true;
      } catch {
        return false;
      }
    };
    assert({
      given: 'principals holding exactly one debate permission each',
      should:
        'admit reads only for debate:read and creates only for debate:create',
      actual: {
        readWithRead: admits(['debate:read'], 'debate:read'),
        readWithCreate: admits(['debate:create'], 'debate:read'),
        readWithManage: admits(['debate:manage'], 'debate:read'),
        createWithRead: admits(['debate:read'], 'debate:create'),
      },
      expected: {
        readWithRead: true,
        readWithCreate: false,
        readWithManage: false,
        createWithRead: false,
      },
    });
  });
});
