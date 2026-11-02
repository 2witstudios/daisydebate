import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PRIVACY_VERSION, TERMS_VERSION } from './versions';

setupRitewayBun();

describe('legal versions', () => {
  test('the current drafts', () => {
    assert({
      given: 'the current terms and privacy versions',
      should: 'name the served texts',
      actual: [TERMS_VERSION, PRIVACY_VERSION],
      expected: ['draft-0.2', 'draft-0.1'],
    });
  });
});
