import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TrainColumns, TrainPage } from './train-page';

setupRitewayBun();

describe('TrainColumns', () => {
  test('main and a labelled aside', () => {
    const html = renderToString(
      h(
        TrainPage,
        null,
        h(TrainColumns, { main: 'MAIN', aside: 'SIDE', asideLabel: 'Summary' }),
      ),
    );
    assert({
      given: 'main and aside content',
      should: 'render both, the aside as a labelled landmark',
      actual: [
        html.includes('MAIN'),
        html.includes('<aside'),
        html.includes('aria-label="Summary"'),
        html.includes('SIDE'),
      ],
      expected: [true, true, true, true],
    });
  });
});
