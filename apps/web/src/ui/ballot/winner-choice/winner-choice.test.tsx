import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotDebaters } from '../../mock/judge';
import { WinnerChoice } from './winner-choice';

setupRitewayBun();

const render = (winner: 'affirmative' | 'negative' | null) =>
  renderToString(
    h(WinnerChoice, {
      debaters: sampleBallotDebaters,
      initial: winner,
      onPick: () => undefined,
    }),
  );

describe('WinnerChoice', () => {
  test('nothing picked', () => {
    const html = render(null);
    assert({
      given: 'no winner yet',
      should:
        'offer both debaters by name and side as one radio group, none checked',
      actual: [
        (html.match(/name="winner"/g) ?? []).length,
        html.includes('Maya Singh') && html.includes('Affirmative'),
        html.includes('Daniel Kim') && html.includes('Negative'),
        html.includes('checked=""'),
      ],
      expected: [2, true, true, false],
    });
  });

  test('a pick', () => {
    const html = render('negative');
    assert({
      given: 'the negative picked',
      should: 'check only the negative',
      actual: [
        (html.match(/checked=""/g) ?? []).length,
        /checked="" value="negative"/.test(html),
      ],
      expected: [1, true],
    });
  });
});
