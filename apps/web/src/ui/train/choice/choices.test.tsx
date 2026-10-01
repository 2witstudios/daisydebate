import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Cards, Chips } from './choices';

setupRitewayBun();

describe('Chips', () => {
  test('radios in a named group with one checked', () => {
    const html = renderToString(
      h(Chips, {
        name: 'side',
        legend: 'Side',
        value: 'neg',
        options: [
          { value: 'aff', label: 'Aff' },
          { value: 'neg', label: 'Neg' },
        ],
      }),
    );
    assert({
      given: 'two options with neg chosen',
      should: 'render radios named side, a legend, and check only neg',
      actual: [
        html.match(/type="radio"/g)?.length,
        html.includes('name="side"'),
        html.includes('<legend class="sr-only">Side</legend>'),
        html.match(/checked=""/g)?.length,
        /value="neg"[^>]*checked=""|checked=""[^>]*value="neg"/.test(html),
      ],
      expected: [2, true, true, 1, true],
    });
  });
});

describe('Cards', () => {
  test('titles and descriptions', () => {
    const html = renderToString(
      h(Cards, {
        name: 'opp',
        legend: 'Opponent',
        value: 'ai',
        options: [
          { value: 'ai', title: 'AI debater', description: 'Sandbox.' },
        ],
      }),
    );
    assert({
      given: 'one card option',
      should: 'show its title and description',
      actual: [html.includes('AI debater'), html.includes('Sandbox.')],
      expected: [true, true],
    });
  });
});
