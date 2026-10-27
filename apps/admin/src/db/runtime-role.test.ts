import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roleRefusal } from './runtime-role';

setupRitewayBun();
test('roleRefusal', () => {
  assert({
    given: 'a production role with schema powers',
    should: 'refuse naming each power and the expected role',
    actual: roleRefusal('production', ['is a superuser', 'owns admin tables']),
    expected:
      'The admin app refuses an ADMIN_DATABASE_URL role that is a superuser, owns admin tables; use daisy_admin_app',
  });
  assert({
    given: 'a DML-only production role, or development as the owner',
    should: 'start',
    actual: [
      roleRefusal('production', []),
      roleRefusal('development', ['is a superuser']),
    ],
    expected: [null, null],
  });
});
