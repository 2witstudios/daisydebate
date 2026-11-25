import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { ArchiveEntry } from '../../../features/recording/archive';
import {
  defaultRecordingsQuery,
  type RecordingsQuery,
} from '../../../features/recording/archive-query';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { RecordingsTab } from './recordings-tab';

setupRitewayBun();

const row: ArchiveEntry = {
  roundId: 'round',
  href: '/recordings/round',
  title: 'Semifinal',
  ranked: true,
  date: '2026-11-02',
  length: '30 min',
  seats: ['@ada', '@lin'],
  result: null,
  media: 'watch',
  transcript: false,
  ownVisibility: null,
};
const render = (
  query: RecordingsQuery,
  rows: readonly ArchiveEntry[] = [],
  nextBefore: string | null = null,
) =>
  renderAccessible(h(RecordingsTab, { query, listing: { rows, nextBefore } }));

describe('RecordingsTab', () => {
  test('the public archive', () => {
    const view = render(defaultRecordingsQuery, [row], 'b'.repeat(24));
    assert({
      given: 'a page with more after it',
      should: 'show the GET filters, the row and a link to the next page',
      actual: [
        view.attribute('search', 'Filter recordings', 'action'),
        view.attribute('search', 'Filter recordings', 'method'),
        view.within('region', 'Recordings').has('link', 'Replay Semifinal'),
        view
          .attribute('link', 'Older recordings', 'href')
          ?.includes(`before=${'b'.repeat(24)}`),
      ],
      expected: ['/recordings', 'get', true, true],
    });
  });

  test('every empty state is honest', () => {
    assert({
      given: 'a filter that matches nothing',
      should: 'offer to clear it',
      actual: render({ ...defaultRecordingsQuery, q: 'zzz' }).has(
        'heading',
        'No recordings match',
      ),
      expected: true,
    });
    assert({
      given: 'an empty public archive',
      should: 'say so',
      actual: render(defaultRecordingsQuery).has(
        'heading',
        'No recordings yet',
      ),
      expected: true,
    });
    assert({
      given: 'no debates of their own',
      should: 'point to a match',
      actual: render({ ...defaultRecordingsQuery, scope: 'mine' }).has(
        'heading',
        'No recorded debates yet',
      ),
      expected: true,
    });
  });
});
