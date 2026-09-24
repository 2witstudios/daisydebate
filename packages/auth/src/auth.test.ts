import { assertRejects, rejectionOf } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requirePermission, type Permission } from './index';

setupRitewayBun();

describe('requirePermission', () => {
  test('authentication and authorization are distinct explicit boundaries', async () => {
    await assertRejects({
      given: 'an anonymous principal',
      should: 'refuse with AUTHENTICATION',
      actual: () => requirePermission({ kind: 'anonymous' }, 'debate:create'),
      code: 'AUTHENTICATION',
    });
    await assertRejects({
      given: 'a signed-in user holding no permissions',
      should: 'refuse with AUTHORIZATION',
      actual: () =>
        requirePermission(
          { kind: 'user', userId: 'u', permissions: [] },
          'debate:create',
        ),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'a service principal holding the required permission',
      should: 'admit the operation',
      actual: await rejectionOf(() =>
        requirePermission(
          { kind: 'service', serviceId: 's', permissions: ['debate:create'] },
          'debate:create',
        ),
      ),
      expected: { code: 'NO_REJECTION' },
    });
  });

  test('debate:read is its own permission, separate from the write permissions', async () => {
    const outcome = (held: readonly Permission[], required: Permission) =>
      rejectionOf(() =>
        requirePermission(
          { kind: 'service', serviceId: 's', permissions: held },
          required,
        ),
      );
    assert({
      given: 'principals holding exactly one debate permission each',
      should:
        'admit reads only for debate:read and creates only for debate:create',
      actual: {
        readWithRead: await outcome(['debate:read'], 'debate:read'),
        readWithCreate: await outcome(['debate:create'], 'debate:read'),
        readWithManage: await outcome(['debate:manage'], 'debate:read'),
        createWithRead: await outcome(['debate:read'], 'debate:create'),
      },
      expected: {
        readWithRead: { code: 'NO_REJECTION' },
        readWithCreate: { code: 'AUTHORIZATION' },
        readWithManage: { code: 'AUTHORIZATION' },
        createWithRead: { code: 'AUTHORIZATION' },
      },
    });
  });
});
