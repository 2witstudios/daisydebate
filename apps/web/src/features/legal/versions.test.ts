import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PRIVACY_VERSION, TERMS_VERSION } from './versions';

setupRitewayBun();

describe('legal versions', () => {
  test('the counsel drafts are draft-1 (WAIT-6.1)', () => {
    assert({
      given: 'the current terms and privacy versions',
      should: 'both be draft-1 until counsel approves a published version',
      actual: [TERMS_VERSION, PRIVACY_VERSION],
      expected: ['draft-1', 'draft-1'],
    });
  });
});
