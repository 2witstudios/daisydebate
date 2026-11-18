import { assert, setupRitewayBun, test } from 'riteway/bun';
import { daisyLadders } from '@daisy/protocol';
import { divisionAudiences, ladderLabel } from './ladder-labels';

setupRitewayBun();

test('ladderLabel', () => {
  assert({
    given: 'each of Daisy’s ladders',
    should: 'name it by division, then style',
    actual: daisyLadders.map(ladderLabel),
    expected: ['Open – Freestyle', 'Youth – Freestyle'],
  });
  assert({
    given: 'each division',
    should: 'say who may debate on it',
    actual: [divisionAudiences.open, divisionAudiences.youth],
    expected: ['18 and over', 'Under 18'],
  });
});
