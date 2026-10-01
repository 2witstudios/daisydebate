import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TrainWelcome } from './welcome';

setupRitewayBun();

describe('TrainWelcome', () => {
  test('one clear first step and empty progress', () => {
    const html = renderToString(h(TrainWelcome, { goal: 0 }));
    assert({
      given: 'an account that has never trained',
      should: 'lead with the first drill and explain the empty progress',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('Start with one argument.'),
        html.includes('href="/train/drill?kind=impact"'),
        html.includes('After your first drill, your progress shows here.'),
        html.includes('None yet.'),
        html.includes('Nothing saved yet'),
        html.includes('Start here'),
        html.includes('href="/train/review"'),
      ],
      expected: [1, true, true, true, true, true, true, false],
    });
  });

  test('the goal picker is a set of links', () => {
    const html = renderToString(h(TrainWelcome, { goal: 3 }));
    assert({
      given: 'a goal of three chosen',
      should: 'link every goal and mark only three as current',
      actual: [
        [1, 2, 3, 5].every((n) =>
          html.includes(`href="/train/welcome?goal=${n}"`),
        ),
        html.match(/aria-current="true"/g)?.length,
        /aria-current="true"[^>]*aria-label="3 sessions a week"/.test(html),
      ],
      expected: [true, 1, true],
    });
  });
});
