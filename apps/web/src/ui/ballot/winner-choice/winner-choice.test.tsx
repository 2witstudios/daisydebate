import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotPlan } from '../../mock/judge.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { WinnerChoice } from './winner-choice';

setupRitewayBun();

const render = (winner: 'affirmative' | 'negative' | null) =>
  renderAccessible(
    h(WinnerChoice, {
      sides: sampleBallotPlan.decided,
      initial: winner,
      onPick: () => undefined,
    }),
  ).within('group', 'Who won');

describe('WinnerChoice', () => {
  test('nothing picked', () => {
    const view = render(null);
    assert({
      given: 'no winner yet',
      should:
        'offer both debaters by name and side as one radio group, none checked',
      actual: [
        view.all('radio').map((radio) => radio.getAttribute('name')),
        view.has('radio', 'Maya Singh Affirmative'),
        view.has('radio', 'Daniel Kim Negative'),
        view.count('radio', undefined, { checked: true }),
      ],
      expected: [['winner', 'winner'], true, true, 0],
    });
  });

  test('a pick', () => {
    const view = render('negative');
    assert({
      given: 'the negative picked',
      should: 'check only the negative',
      actual: [
        view.count('radio', undefined, { checked: true }),
        view.attribute('radio', undefined, 'value', { checked: true }),
      ],
      expected: [1, 'negative'],
    });
  });
});
