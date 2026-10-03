import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { ballotView } from '../../../features/judge/ballot';
import { initialMockForm } from '../../../features/mock-form/form';

setupRitewayBun();

// The form reads the Next router, which only exists in a running app.
await mockNextRouter();
const { BallotPage } = await import('./ballot-page');

const render = (state: 'waiting' | 'open' | 'submitted') =>
  renderToString(
    h(BallotPage, {
      view: ballotView('started', 'Evening round', state),
      action: async () => initialMockForm,
    }),
  );

describe('BallotPage', () => {
  test('open', () => {
    const html = render('open');
    assert({
      given: 'an open ballot',
      should:
        'offer three decisions, two scores and a reason in a real form, and no confirmation',
      actual: [
        html.match(/<h1 /g)?.length,
        (html.match(/name="decision"/g) ?? []).length,
        html.includes('name="affirmative-score"'),
        html.includes('name="negative-score"'),
        html.includes('name="reason"'),
        html.includes('Submit ballot'),
        html.includes('Ballot submitted'),
      ],
      expected: [1, 3, true, true, true, true, false],
    });
  });

  test('not open yet', () => {
    const html = render('waiting');
    assert({
      given: 'a ballot before the last turn ends',
      should: 'say it opens when the last turn ends and offer no form',
      actual: [
        html.includes('opens when the last turn ends'),
        html.includes('<form'),
        html.includes('Follow the debate'),
      ],
      expected: [true, false, true],
    });
  });

  test('submitted', () => {
    const html = render('submitted');
    assert({
      given: 'a submitted ballot',
      should:
        'confirm, say it cannot be sent again, offer no form and link to the result',
      actual: [
        html.includes('Ballot submitted'),
        html.includes('cannot be sent again'),
        html.includes('<form'),
        html.includes('See the result'),
      ],
      expected: [true, true, false, true],
    });
  });
});
