import { assert, setupRitewayBun, test } from 'riteway/bun';
import { browserRuntimeTarget } from '../integration/browser-runtime-target';

setupRitewayBun();
const administrator = 'postgres://fixture@localhost:5432/daisy_wt_proof_test';
const browser = 'postgres://daisy_e2e@localhost:5432/daisy_wt_proof_e2e';

test('native browser role binding uses only its admitted isolated administrator target', () => {
  const target = new URL(browserRuntimeTarget(administrator, browser, 'proof'));
  assert({
    given: 'the native slot test administrator and separate browser login',
    should:
      'retain configured administrator identity and select only its e2e database',
    actual: { user: target.username, path: target.pathname },
    expected: { user: 'fixture', path: '/daisy_wt_proof_e2e' },
  });
});
for (const rejected of [
  administrator.replace('localhost', 'foreign.example'),
  administrator.replace('5432', '5433'),
  administrator.replace('_proof_test', '_foreign_test'),
  `${administrator}?options=unexpected`,
  `${administrator}#unexpected`,
])
  test('foreign administrator target refuses without a connection', () => {
    let refused = false;
    try {
      browserRuntimeTarget(rejected, browser, 'proof');
    } catch {
      refused = true;
    }
    assert({
      given: 'a mismatched isolated administrator',
      should: 'refuse',
      actual: refused,
      expected: true,
    });
  });
