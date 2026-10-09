import { assert, setupRitewayBun, test } from 'riteway/bun';
import { messagingBrowserTarget } from '../e2e/support/messaging-data';
setupRitewayBun();
test('messaging browser data refuses foreign slots, production targets and writer roles before connect', () => {
  const own = 'postgres://daisy_e2e:test@localhost:5432/daisy_wt_abc_e2e';
  assert({
    given: 'the exact native test target',
    should: 'admit it',
    actual: messagingBrowserTarget({ E2E_DATABASE_URL: own }, '/tmp/wt-abc'),
    expected: own,
  });
  for (const url of [
    own.replace('wt_abc', 'wt_other'),
    own.replace('localhost', 'db.example'),
    own.replace('daisy_e2e', 'postgres'),
    own.replace('_e2e', '_test'),
  ]) {
    let refused = false;
    try {
      messagingBrowserTarget({ E2E_DATABASE_URL: url }, '/tmp/wt-abc');
    } catch {
      refused = true;
    }
    assert({
      given: 'a foreign target or non-test role',
      should: 'refuse without opening a connection',
      actual: refused,
      expected: true,
    });
  }
});
