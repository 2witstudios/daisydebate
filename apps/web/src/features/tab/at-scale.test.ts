import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  andMore,
  capped,
  collapsed,
  filterRows,
  matchesQuery,
  mergeSimilar,
  pageFilterOf,
  pageHref,
  showAllHref,
  statusChoices,
} from './at-scale';
import {
  fixtureFacets,
  needKeyOf,
  roomStatuses,
  roomStatusLabels,
} from './at-scale-rooms';
import { sampleTabRoundView, sampleTimeSlotView } from './sample/tab-round';
import type { SampleScene } from './sample/scene';

setupRitewayBun();

const large = (moment: SampleScene['moment']): SampleScene => ({
  viewer: 'host',
  moment,
  scale: 'large',
});

describe('the page filter', () => {
  test('the URL is untrusted', () => {
    const statuses = ['live', 'judging'] as const;
    const read = pageFilterOf(
      { q: ['  jensen ', ' Okafor  '], status: 'live', open: ['a', 'b'] },
      statuses,
    );
    assert({
      given:
        'a repeated search, a known status, two open groups; then an unknown status and a long search',
      should:
        'take the last search trimmed, the status, every open group; read an unknown status as all and cut the search',
      actual: [
        read.query,
        read.status,
        [...read.open],
        pageFilterOf({ status: 'admin', q: 'x'.repeat(200) }, statuses).status,
        pageFilterOf({ q: 'x'.repeat(200) }, statuses).query.length,
      ],
      expected: ['Okafor', 'live', ['a', 'b'], 'all', 80],
    });
  });

  test('addresses keep only what is set', () => {
    const filter = pageFilterOf({ q: 'Room 4', status: 'live' }, ['live']);
    assert({
      given: 'no filter, then a search and a status, then a group opened',
      should:
        "give the bare path, then the params, then the open group too, and keep a page's own params",
      actual: [
        pageHref('/host/x', pageFilterOf({}, ['live'])),
        pageHref('/host/x', filter),
        showAllHref('/host/x', filter, 'judging'),
        pageHref('/host/d?fixture=doyle-sato&q=old', filter),
      ],
      expected: [
        '/host/x',
        '/host/x?q=Room+4&status=live',
        '/host/x?q=Room+4&status=live&open=judging',
        '/host/d?fixture=doyle-sato&q=Room+4&status=live',
      ],
    });
  });

  test('a search finds every word, ignoring case and accents', () => {
    assert({
      given: 'a row named "Zoë Ferreira · Room 41 · Judge P. Nguyen"',
      should:
        'find it by any of its words in any case, and not by a missing one',
      actual: [
        matchesQuery('', ['Zoë Ferreira']),
        matchesQuery('zoe room 41', ['Zoë Ferreira', 'Room 41']),
        matchesQuery('NGUYEN', ['P. Nguyen']),
        matchesQuery('ferreira room 9', ['Zoë Ferreira', 'Room 41']),
      ],
      expected: [true, true, true, false],
    });
  });

  test('the large round filters by status and search', () => {
    const round = sampleTabRoundView(
      'autumn-open',
      'varsity-debate',
      '3',
      large('prelims'),
    );
    const rows = round?.read.open ?? [];
    const filter = pageFilterOf({ status: 'judging' }, roomStatuses);
    const choices = statusChoices(rows, filter, fixtureFacets, {
      path: '/host/r',
      labels: roomStatusLabels,
      statuses: roomStatuses,
    });
    assert({
      given: "the large round 3's open rooms and the Judging filter",
      should:
        'keep the 34 judging rooms, count every status, and find one room by its judge',
      actual: [
        filterRows(rows, filter, fixtureFacets).length,
        choices.map((choice) => `${choice.label} ${choice.count}`),
        choices.find((choice) => choice.selected)?.id,
        choices[2]?.href,
        filterRows(
          rows,
          pageFilterOf({ q: 'reyes' }, roomStatuses),
          fixtureFacets,
        ).map((fixture) => fixture.room?.name),
      ],
      expected: [
        34,
        ['All 75', 'Waiting 0', 'Live 41', 'Judging 34', 'Finished 0'],
        'judging',
        '/host/r?status=live',
        ['Room 6'],
      ],
    });
  });
});

describe('needs you', () => {
  test('capped, kept first', () => {
    assert({
      given: 'six items capped at four, and two capped at four',
      should: 'show the first four and count two; show both and count none',
      actual: [capped([1, 2, 3, 4, 5, 6], 4), capped(['a', 'b'], 4)],
      expected: [
        { shown: [1, 2, 3, 4], hidden: 2 },
        { shown: ['a', 'b'], hidden: 0 },
      ],
    });
  });

  test('similar items merge where they sit first', () => {
    const round = sampleTabRoundView(
      'autumn-open',
      'varsity-debate',
      '3',
      large('prelims'),
    );
    const slot = sampleTimeSlotView('winter-classic', '1200', large('prelims'));
    const needs = (round?.read.open ?? []).filter(
      (fixture) =>
        fixture.state.kind === 'ballot_overdue' ||
        fixture.state.kind === 'confirmation_requested',
    );
    assert({
      given:
        "the large round's overdue ballots and forfeit, and the large slot's concerns",
      should:
        'merge the six overdue ballots into one row before the forfeit, and the three unreplaced withdrawals into one',
      actual: [
        mergeSimilar(needs, needKeyOf).map(
          (row) => `${row.key ?? 'one'} ${row.items.length}`,
        ),
        mergeSimilar(slot?.read.concerns ?? [], needKeyOf).map(
          (row) => `${row.key ?? 'one'} ${row.items.length}`,
        ),
      ],
      expected: [
        ['ballot_overdue 6', 'one 1'],
        ['one 1', 'one 1', 'judge_withdrawn 3', 'one 1'],
      ],
    });
  });

  test('a merged row names its first and counts the rest', () => {
    assert({
      given: 'one, two and seven titles',
      should: 'name one, name both, or name the first and count the others',
      actual: [
        andMore(['Jensen v Amari']),
        andMore(['Jensen v Amari', 'Haddad v Castillo']),
        andMore(['Jensen v Amari', ...Array.from({ length: 6 }, () => 'x')]),
      ],
      expected: [
        'Jensen v Amari',
        'Jensen v Amari and Haddad v Castillo',
        'Jensen v Amari and 6 more',
      ],
    });
  });
});

describe('collapsed groups', () => {
  test('a long group shows its first rows and counts the rest', () => {
    const rooms = Array.from({ length: 34 }, (_, n) => n);
    assert({
      given: '34 judging rooms cut to 3; the same opened; four rooms cut to 3',
      should:
        'show 3 and count 31 of 34; show all 34; show all four rather than "1 more"',
      actual: [
        collapsed(rooms, { limit: 3, open: false }).rest,
        collapsed(rooms, { limit: 3, open: false }).total,
        collapsed(rooms, { limit: 3, open: true }).shown.length,
        collapsed([1, 2, 3, 4], { limit: 3, open: false }),
      ],
      expected: [31, 34, 34, { shown: [1, 2, 3, 4], rest: 0, total: 4 }],
    });
  });
});
