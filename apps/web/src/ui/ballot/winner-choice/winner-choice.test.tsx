import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleBallotPlan } from '../../mock/judge.test-support';
import { WinnerChoice } from './winner-choice';

setupRitewayBun();

const render = (winner: 'affirmative' | 'negative' | null) =>
  renderToString(
    h(WinnerChoice, {
      sides: sampleBallotPlan.decided,
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

  test('a narrow column', () => {
    const name = 'Alexandria Montgomery-Fitzwilliam';
    const html = renderToString(
      h(WinnerChoice, {
        sides: [
          { ...sampleBallotPlan.decided[0]!, name, role: 'Affirmative' },
          ...sampleBallotPlan.decided.slice(1),
        ],
        initial: null,
        onPick: () => undefined,
      }),
    );
    assert({
      given: 'a long name in a column narrower than two cards',
      should:
        'lay the cards out by the group’s own width, keep the name on one truncated line, and draw the side label whole',
      actual: [
        /class="@container"><fieldset class="[^"]*grid-cols-1[^"]*@ballot-sides:grid-cols-2/.test(
          html,
        ),
        html.includes('max-narrow:grid-cols-1'),
        new RegExp(`title="${name}" class="[^"]*\\btruncate\\b`).test(html),
        html.includes('>Affirmative</span>'),
      ],
      expected: [true, false, true, true],
    });
  });
});
