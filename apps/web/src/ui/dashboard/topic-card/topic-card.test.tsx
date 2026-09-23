import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TopicCard } from './topic-card';
import { createInitialState } from '../../store/state';
import { UiStoreProvider } from '../../store/store';

setupRitewayBun();

describe('TopicCard', () => {
  test("renders today's topic from the store with its call to action", () => {
    const seed = createInitialState();
    const initialState = {
      ...seed,
      resources: { ...seed.resources, todaysTopic: 'Should tests come first?' },
    };
    const html = renderToString(
      h(UiStoreProvider, { initialState, children: h(TopicCard) }),
    );
    assert({
      given: 'a store topic',
      should: 'render the topic under its heading with the join action',
      actual: [
        html.includes('Today&#x27;s Topic'),
        html.includes('Should tests come first?'),
        html.includes('Join the Discussion</a>'),
        html.includes('href="/play"'),
      ],
      expected: [true, true, true, true],
    });
  });
});
