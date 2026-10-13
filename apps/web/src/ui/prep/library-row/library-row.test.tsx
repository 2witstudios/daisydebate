import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listLibrary } from '../../../features/prep/library/list-library';
import { defaultLibraryQuery } from '../../../features/prep/library/library-query';
import { LibraryList } from './library-row';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const rows = listLibrary(defaultLibraryQuery, now).rows;

describe('LibraryList', () => {
  test('rows open the preview, or the item on a phone', () => {
    const html = renderToString(h(LibraryList, { label: 'Items', rows }));
    assert({
      given: 'the default library rows',
      should:
        'link each row to its preview and to its item, mark the first selected, name its kind and show its meta',
      actual: [
        html.match(/<li class="[^"]*border-t/g)?.length,
        html.includes('href="/prep?item=rights-framework"'),
        html.includes('href="/prep/briefs/rights-framework"'),
        html.includes('href="/prep/cards/cost-estimates"'),
        html.includes('href="/prep/cases/aff-rights"'),
        html.match(/aria-current="true"/g)?.length,
        html.includes('>Evidence card<'),
        html.includes('Edited 2 days ago'),
        html.includes('Used in 3'),
      ],
      expected: [11, true, true, true, true, 1, true, true, true],
    });
  });
});
