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

const debaters = {
  affirmative: { name: 'Maya Singh' },
  negative: { name: 'Daniel Kim' },
};

const render = (state: 'waiting' | 'open' | 'submitted') =>
  renderToString(
    h(BallotPage, {
      view: ballotView('started', 'Evening round', state, debaters),
      action: async () => initialMockForm,
    }),
  );

const count = (html: string, pattern: RegExp) =>
  (html.match(pattern) ?? []).length;

describe('BallotPage', () => {
  test('open', () => {
    const html = render('open');
    assert({
      given: 'an open ballot',
      should:
        'offer both debaters by name, twenty sliders, a reason, feedback for each and a conduct report in one real form',
      actual: [
        count(html, /<h1 /g),
        count(html, /<form/g),
        count(html, /name="winner"/g),
        html.includes('Maya Singh') && html.includes('Daniel Kim'),
        count(html, /type="range"/g),
        html.includes('name="reason"'),
        html.includes('name="feedback-affirmative"'),
        html.includes('name="feedback-negative"'),
        html.includes('name="conduct"'),
        html.includes('name="decision"'),
        html.includes('Submit ballot'),
        html.includes('Ballot submitted'),
      ],
      expected: [1, 1, 2, true, 20, true, true, true, true, false, true, false],
    });
  });

  test('a fresh sheet', () => {
    const html = render('open');
    assert({
      given: 'an open ballot before anything is entered',
      should:
        'start every score at 3, total 30 a side, name no winner and ask for no low-point confirmation',
      actual: [
        count(html, /value="3"/g),
        count(html, />30</g),
        html.includes('No winner picked'),
        html.includes('name="low-point"'),
      ],
      expected: [20, 2, true, false],
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
