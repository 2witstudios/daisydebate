import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  parseDebateQuery,
  type DebateQuery,
} from '../../../features/debates/state';
import { debateView } from '../../../features/debates/view';
import type { RoomInfo } from '../../../features/rooms/view';
import { DebatePage } from './debate-page';

setupRitewayBun();

const info: RoomInfo = {
  id: 'demo',
  title: 'Evening round',
  mode: 'practice',
  hostHandle: 'host-two',
};
const render = (change: Partial<DebateQuery> = {}) =>
  renderToString(
    h(DebatePage, {
      view: debateView(info, { ...parseDebateQuery({}), ...change }),
    }),
  );

describe('DebatePage', () => {
  test('a live turn', () => {
    const html = render();
    assert({
      given: 'a turn in progress',
      should: 'show the turn, a timer, the turn list and the demo controls',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Affirmative speech'),
        html.includes('role="timer"'),
        html.includes('2:42'),
        html.includes('Your turn'),
        html.includes('aria-current="step"'),
        html.includes('Demo controls'),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });

  test('the AI judge awaited', () => {
    const html = render({ turn: 6, judgeKind: 'ai' });
    assert({
      given: 'the speaking over with the AI judge',
      should: 'offer Ask the AI judge and say it is a placeholder',
      actual: [
        html.includes('Ask the AI judge'),
        html.includes('placeholder AI judge rules at random'),
        html.includes('The speaking is over'),
      ],
      expected: [true, true, true],
    });
  });

  test('a ruling', () => {
    const html = render({ turn: 6, judgeKind: 'ai', ruledBy: 'ai' });
    assert({
      given: 'a placeholder ruling',
      should: 'name the winner, label it a placeholder and link back',
      actual: [
        /(Affirmative|Negative) wins/.test(html),
        html.includes('Placeholder AI ruling'),
        html.includes('Rematch'),
        html.includes('Back to the room'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('an outsider', () => {
    const html = render({ viewer: 'outsider' });
    assert({
      given: 'a viewer who is not in the debate',
      should: 'say so and offer Watch',
      actual: [
        html.includes('You are not in this debate'),
        html.includes('href="/watch"'),
        html.includes('Evening round'),
      ],
      expected: [true, true, false],
    });
  });
});
