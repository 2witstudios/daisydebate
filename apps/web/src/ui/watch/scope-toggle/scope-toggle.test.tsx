import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ScopeToggle } from './scope-toggle';

setupRitewayBun();

describe('ScopeToggle', () => {
  test('two radios in one group, the value checked', () => {
    const html = renderToString(h(ScopeToggle, { value: 'mine' }));
    assert({
      given: 'the my-debates scope',
      should: 'render radios named scope with My debates checked',
      actual: [
        (html.match(/name="scope"/g) ?? []).length,
        /value="mine"[^>]*checked=""|checked=""[^>]*value="mine"/.test(html),
        html.includes('Whose recordings'),
      ],
      expected: [2, true, true],
    });
  });
});
