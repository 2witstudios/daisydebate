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
  'invalid target',
  administrator.replace('localhost', 'foreign.example'),
  administrator.replace('5432', '5433'),
  administrator.replace('_proof_test', '_foreign_test'),
  `${administrator}?options=unexpected`,
  `${administrator}#unexpected`,
])
  test('foreign administrator target refuses without a connection', () => {
    let refusal = '';
    try {
      browserRuntimeTarget(rejected, browser, 'proof');
    } catch (error) {
      refusal = error instanceof Error ? error.message : 'unknown';
    }
    assert({
      given: 'a mismatched isolated administrator',
      should: 'refuse with a fixed message rather than the input URL',
      actual: refusal,
      expected: 'Realtime browser fixture administrator slot refused',
    });
  });
