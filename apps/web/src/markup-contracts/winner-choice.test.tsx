import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { sampleBallotPlan } from '../ui/mock/judge.test-support';
import { WinnerChoice } from '../ui/ballot/winner-choice/winner-choice';

setupRitewayBun();

/**
 * The narrow-column layout is a design-system visual contract with no
 * accessible equivalent: the cards lay out by the group's own container
 * width (`@ballot-sides`), never the viewport, and a long name wraps rather
 * than truncates.
 */
describe('WinnerChoice markup', () => {
  test('a narrow column', () => {
    const name = 'Alexandria Montgomery-Fitzwilliam';
    const html = renderMarkup(
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
        'lay the cards and their padding out by the group’s own width, show the whole name (breaking only a word too long for its line), and draw the side label whole',
      actual: [
        /class="@container"><fieldset class="[^"]*grid-cols-1[^"]*@ballot-sides:grid-cols-2/.test(
          html,
        ),
        /max-narrow:(?:grid-cols-1|gap-3|p-3)/.test(html),
        html.includes('@max-ballot-sides:p-3'),
        html.includes(`>${name}</span>`),
        /\btruncate\b/.test(html),
        html.includes('wrap-break-word'),
        html.includes('>Affirmative</span>'),
      ],
      expected: [true, false, true, true, false, true, true],
    });
  });
});
