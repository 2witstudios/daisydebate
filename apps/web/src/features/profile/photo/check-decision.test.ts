import { assert, setupRitewayBun, test } from 'riteway/bun';
import { photoCheckVerdicts } from '@daisy/protocol/public-profile';
import { checkDecision } from './check-decision';
setupRitewayBun();

test('checkDecision fails closed', () => {
  assert({
    given: 'every verdict and no verdict',
    should: 'publish only an allow, refuse a block, review the rest',
    actual: [...photoCheckVerdicts, null].map((verdict) => [
      verdict,
      checkDecision(verdict).kind,
    ]),
    expected: [
      ['allow', 'publish'],
      ['review', 'review'],
      ['block', 'refuse'],
      [null, 'review'],
    ],
  });
});
