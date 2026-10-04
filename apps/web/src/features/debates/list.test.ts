import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleMyDebates } from '../../ui/mock/my-debates';
import {
  debatesHref,
  endedLabel,
  judgeLine,
  listing,
  pageSize,
  parseDebatesQuery,
  resultHref,
} from './list';

setupRitewayBun();

const now = '2026-10-03T12:00:00.000Z';
const all = sampleMyDebates(now);

describe('parseDebatesQuery', () => {
  test('defaults and nonsense', () => {
    assert({
      given: 'no query, and a bad tab and page',
      should: 'show every debate on the first page',
      actual: [
        parseDebatesQuery({}),
        parseDebatesQuery({ tab: 'zzz', page: '0' }),
      ],
      expected: [
        { tab: 'all', page: 1 },
        { tab: 'all', page: 1 },
      ],
    });
  });

  test('the address round trip', () => {
    assert({
      given: 'a tab and a page written to an address',
      should: 'omit defaults and keep the rest',
      actual: [
        debatesHref({ tab: 'all', page: 1 }),
        debatesHref({ tab: 'won', page: 2 }),
      ],
      expected: ['/debates', '/debates?tab=won&page=2'],
    });
  });
});

describe('listing', () => {
  test('all, newest first, one page', () => {
    const view = listing(all, { tab: 'all', page: 1 });
    assert({
      given: 'the whole history',
      should: 'show the newest five and count the pages',
      actual: [
        view.rows.length,
        view.rows[0]?.id,
        view.pageCount,
        view.counts.all,
      ],
      expected: [pageSize, 'd-evening-round', 2, all.length],
    });
  });

  test('tabs', () => {
    const wins = listing(all, { tab: 'won', page: 1 });
    const ranked = listing(all, { tab: 'ranked', page: 1 });
    assert({
      given: 'the wins tab and the ranked tab',
      should: 'keep only wins, and only ranked debates',
      actual: [
        wins.rows.every((debate) => debate.result === 'won'),
        ranked.rows.every((debate) => debate.mode === 'ranked'),
      ],
      expected: [true, true],
    });
  });

  test('a page past the end', () => {
    assert({
      given: 'a page number beyond the last',
      should: 'show the last page',
      actual: listing(all, { tab: 'all', page: 99 }).page,
      expected: 2,
    });
  });
});

describe('labels', () => {
  test('when and who', () => {
    assert({
      given: 'a debate that ended 3 hours ago, 27 hours ago and 5 days ago',
      should: 'say Today, Yesterday and the number of days',
      actual: [
        endedLabel(all[0]!.endedAt, now),
        endedLabel(all[1]!.endedAt, now),
        endedLabel(all[4]!.endedAt, now),
      ],
      expected: ['Today', 'Yesterday', '5 days ago'],
    });
  });

  test('the judge and the result link', () => {
    assert({
      given: 'a person judge, the AI judge and an assigned judge',
      should: 'name each and open the completed result',
      actual: [
        judgeLine({ kind: 'person', handle: 'judge-one' }),
        judgeLine({ kind: 'ai' }),
        judgeLine({ kind: 'assigned' }),
        resultHref(all[2]!),
      ],
      expected: [
        'Judge @judge-one',
        'Placeholder AI judge',
        'Judge assigned by Daisy',
        '/debates/d-ai-spar?turn=6&kind=ai&by=ai&win=affirmative',
      ],
    });
  });

  test('the result link carries the recorded outcome', () => {
    const byId = (id: string) => all.find((debate) => debate.id === id)!;
    assert({
      given: 'a win, a loss as the negative, and a draw from the history',
      should:
        'name the winning side, or a draw, rather than leave the page to work it out',
      actual: [
        resultHref(byId('d-evening-round')),
        resultHref(byId('d-ladder-climb')),
        resultHref(byId('d-semifinal-rehearsal')),
      ].map((href) => new URL(href, 'https://x').searchParams.get('win')),
      expected: ['affirmative', 'affirmative', 'draw'],
    });
  });
});
