import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listLibrary } from '../../../features/prep/list-library';
import { defaultLibraryQuery } from '../../../features/prep/library-query';
import { LibraryList } from './library-row';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const rows = listLibrary(defaultLibraryQuery, now).rows;

describe('LibraryList', () => {
  test('rows are links to their items', () => {
    const html = renderToString(h(LibraryList, { label: 'Items', rows }));
    assert({
      given: 'the default library rows',
      should: 'link every row to its item, name its kind and show the edit age',
      actual: [
        html.match(/<li class="[^"]*border-t/g)?.length,
        html.includes('href="/prep/briefs/rights-framework"'),
        html.includes('href="/prep/cards/cost-estimates"'),
        html.includes('href="/prep/cases/aff-rights"'),
        html.includes('Evidence card: '),
        html.includes('Edited 2 days ago'),
        html.includes('Used in 3'),
      ],
      expected: [11, true, true, true, true, true, true],
    });
  });
});
