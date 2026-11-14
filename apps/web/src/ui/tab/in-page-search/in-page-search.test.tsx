import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { pageFilterOf, statusChoices } from '../../../features/tab/at-scale';
import { WithAppRouter } from '../../test-support/app-router';
import { InPageSearch, segmentClass } from './in-page-search';

setupRitewayBun();

type Row = { readonly name: string; readonly status: 'live' | 'judging' };
const rows: readonly Row[] = [
  { name: 'Jensen v Amari', status: 'live' },
  { name: 'Okafor v Wu', status: 'judging' },
  { name: 'Reid v Nakata', status: 'live' },
];
const statuses = ['live', 'judging'] as const;
const facets = {
  textOf: (row: Row) => [row.name],
  statusOf: (row: Row) => row.status,
};

const render = (params: Record<string, string>, path: string) => {
  const filter = pageFilterOf(params, statuses);
  return renderToStaticMarkup(
    <WithAppRouter>
      <InPageSearch
        path={path}
        filter={filter}
        placeholder="Find a room, entry or judge"
        label="Find a room, entry or judge"
        statusLabel="Rooms by status"
        choices={statusChoices(rows, filter, facets, {
          path,
          labels: { live: 'Live', judging: 'Judging' },
          statuses,
        })}
      />
    </WithAppRouter>,
  );
};

describe('InPageSearch', () => {
  test('a GET search that keeps the status and the page’s own params', () => {
    const html = render(
      { q: 'jensen', status: 'live' },
      '/host/d?fixture=doyle-sato',
    );
    assert({
      given: 'a search for Jensen among live rooms on a draw page',
      should:
        'post back to the page by GET with the search, the status and the fixture kept',
      actual: [
        html.includes('method="get"'),
        html.includes('action="/host/d"'),
        html.includes('role="search"'),
        html.includes('value="jensen"'),
        html.includes('name="status" value="live"'),
        html.includes('name="fixture" value="doyle-sato"'),
        html.includes('aria-label="Find a room, entry or judge"'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('status choices count what the search finds and mark the chosen one', () => {
    const html = render({ status: 'judging' }, '/host/r');
    assert({
      given: 'three rooms, the Judging filter chosen',
      should: 'offer All 3, Live 2 and Judging 1 as links with Judging current',
      actual: [
        html.includes('aria-label="Rooms by status"'),
        /href="\/host\/r"[^>]*>All<span[^>]*>3</.test(html),
        /href="\/host\/r\?status=live"[^>]*>Live<span[^>]*>2</.test(html),
        /aria-current="true"[^>]*>Judging<span[^>]*>1</.test(html),
        segmentClass(true).includes('font-strong'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
