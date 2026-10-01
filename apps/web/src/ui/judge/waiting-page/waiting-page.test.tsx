import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { waitingView } from '../../../features/judge/flow';
import { WaitingPage } from './waiting-page';

setupRitewayBun();

const pool = { waitedSeconds: 14, offerWindowSeconds: 120 };
const render = (step: 'waiting' | 'left') =>
  renderToString(h(WaitingPage, { view: waitingView(step, pool) }));

describe('WaitingPage', () => {
  test('in the pool', () => {
    const html = render('waiting');
    assert({
      given: 'a judge in the pool',
      should:
        'say so, show the wait and window, list no debates and offer Cancel',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('In the judge pool'),
        html.includes('Looking for a debate'),
        html.includes('0:14'),
        html.includes('2 min'),
        html.includes('There is no list of debates to browse'),
        /<a [^>]*href="\/judge\/waiting\?step=left"[^>]*>Cancel<\/a>/.test(
          html,
        ),
        html.includes('What happens next'),
        html.includes('Keep this page open'),
      ],
      expected: [1, true, true, true, true, true, true, true, true],
    });
  });

  test('after cancelling', () => {
    const html = render('left');
    assert({
      given: 'a judge who cancelled',
      should:
        'say they left, record nothing against them and offer Start judging and Back to Judge',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('You left the judge pool'),
        html.includes('nothing is recorded against you'),
        /<a [^>]*href="\/judge\/waiting"[^>]*>Start judging<\/a>/.test(html),
        /<a [^>]*href="\/judge"[^>]*>Back to Judge<\/a>/.test(html),
        html.includes('In the judge pool'),
      ],
      expected: [1, true, true, true, true, false],
    });
  });
});
