import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TagList } from './tag-list';

setupRitewayBun();

describe('TagList', () => {
  test('tags and none', () => {
    assert({
      given: 'two tags, then none',
      should: 'list the tags and render nothing for an empty list',
      actual: [
        renderToString(h(TagList, { tags: ['costs', 'rights'] })).match(/<li /g)
          ?.length,
        renderToString(h(TagList, { tags: [] })),
      ],
      expected: [2, ''],
    });
  });
});
