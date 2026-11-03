import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ArchiveEntry } from '../../../features/recording/archive';
import {
  defaultRecordingsQuery,
  type RecordingsQuery,
} from '../../../features/recording/archive-query';
import { RecordingsTab } from './recordings-tab';

setupRitewayBun();

const row: ArchiveEntry = {
  roundId: 'round',
  href: '/recordings/round',
  title: 'Semifinal',
  ranked: true,
  date: '2026-11-02',
  length: '30 min',
  aff: '@ada',
  neg: '@lin',
  result: null,
  media: 'watch',
  transcript: false,
  ownVisibility: null,
};
const render = (
  query: RecordingsQuery,
  rows: readonly ArchiveEntry[] = [],
  nextBefore: string | null = null,
) => renderToString(h(RecordingsTab, { query, listing: { rows, nextBefore } }));

describe('RecordingsTab', () => {
  test('the public archive', () => {
    const html = render(defaultRecordingsQuery, [row], 'b'.repeat(24));
    assert({
      given: 'a page with more after it',
      should: 'show the GET filters, the row and a link to the next page',
      actual: [
        /<form [^>]*action="\/recordings"/.test(html),
        html.includes('method="get"'),
        html.includes('Replay Semifinal'),
        html.includes(`before=${'b'.repeat(24)}`),
      ],
      expected: [true, true, true, true],
    });
  });

  test('every empty state is honest', () => {
    assert({
      given: 'a filter that matches nothing',
      should: 'offer to clear it',
      actual: render({ ...defaultRecordingsQuery, q: 'zzz' }).includes(
        'No recordings match',
      ),
      expected: true,
    });
    assert({
      given: 'an empty public archive',
      should: 'say so',
      actual: render(defaultRecordingsQuery).includes('No recordings yet'),
      expected: true,
    });
    assert({
      given: 'no debates of their own',
      should: 'point to a match',
      actual: render({ ...defaultRecordingsQuery, scope: 'mine' }).includes(
        'No recorded debates yet',
      ),
      expected: true,
    });
  });
});
