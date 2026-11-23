import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { PageHeader } from './page-header';

setupRitewayBun();

describe('PageHeader', () => {
  test('title, lede and actions', () => {
    const view = renderAccessible(
      h(PageHeader, {
        title: 'Judge',
        lede: 'Click to judge.',
        actions: h('b', null, 'Offer'),
      }),
    );
    assert({
      given: 'a title, a lede and actions',
      should: 'render one h1, the lede and the actions',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        view.text('paragraph'),
        view.textContent().includes('Offer'),
      ],
      expected: [1, 'Click to judge.', true],
    });
  });

  test('no lede', () => {
    assert({
      given: 'a title alone',
      should: 'render no paragraph',
      actual: renderAccessible(h(PageHeader, { title: 'Judge' })).count(
        'paragraph',
      ),
      expected: 0,
    });
  });
});
