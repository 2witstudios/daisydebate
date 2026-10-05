import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveView } from '../../../features/train/live';
import { unavailableLinks } from '../../../features/train/live-links';
import { defaultConfig } from '../../../features/train/practice';
import { defaultHubQuery } from '../../../features/train/query';
import { PracticeUnavailable } from './practice-unavailable';

setupRitewayBun();

describe('PracticeUnavailable', () => {
  test('says what stopped and offers three ways on', () => {
    const view = liveView(defaultConfig, 'aff', 2, () => ({ ok: false }));
    if (view?.kind !== 'unavailable') throw new Error('expected unavailable');
    const html = renderToString(
      h(PracticeUnavailable, {
        view,
        links: unavailableLinks(defaultConfig, defaultHubQuery, 2),
      }),
    );
    assert({
      given: 'the opponent unavailable on turn 2',
      should: 'name the turn, the paused clock and the three actions',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('The AI debater did not answer.'),
        html.includes('Stopped during turn 2.'),
        html.includes('clock is paused'),
        html.includes('href="/train/practice/live?turn=2"'),
        html.includes('href="/train/practice/live?opp=solo&amp;turn=2"'),
        html.includes('href="/train/practice/debrief?upto=2"'),
        html.includes(', opponent unavailable'),
      ],
      expected: [1, true, true, true, true, true, true, true],
    });
  });
});
