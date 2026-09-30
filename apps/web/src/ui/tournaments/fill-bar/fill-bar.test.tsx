import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FillBar } from './fill-bar';
import { fillBarClass, fillTrackClass, fillWidthClass } from './fill-bar-class';

setupRitewayBun();

describe('fillWidthClass', () => {
  test('rounds to the nearest twelfth and clamps', () => {
    assert({
      given: '0, 25, 75, 100 and out-of-range percents',
      should: 'pick the literal width class',
      actual: [0, 25, 75, 100, -5, 140].map(fillWidthClass),
      expected: ['w-0', 'w-3/12', 'w-9/12', 'w-full', 'w-0', 'w-full'],
    });
  });
});

describe('FillBar', () => {
  test('is an image with its meaning as the name', () => {
    const html = renderToString(
      h(FillBar, { percent: 75, label: '24 of 32 places taken' }),
    );
    assert({
      given: '75 percent',
      should: 'name the measure and fill nine twelfths',
      actual: [
        html.includes('role="img"'),
        html.includes('aria-label="24 of 32 places taken"'),
        html.includes('w-9/12'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('fill tones', () => {
  test('the stage tone reads on the dark stage', () => {
    assert({
      given: 'both tones at 50 percent',
      should: 'use accent on the page and stage accent on the stage',
      actual: [
        fillBarClass(50, 'default'),
        fillBarClass(50, 'stage'),
        fillTrackClass('stage').includes('border-stage-ink-muted'),
      ],
      expected: [
        'block h-full rounded-round bg-accent w-6/12',
        'block h-full rounded-round bg-stage-accent w-6/12',
        true,
      ],
    });
  });
});
