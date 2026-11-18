import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ladderRoomsLine,
  lockedLadderLine,
  noLadderReason,
  rankedLadderLead,
} from '../../features/play/ladder-division-words';
import type { MemberStanding } from '../../features/ratings/read-member';
import { RankedLadders, rankedLadderView } from './ranked-ladders';

setupRitewayBun();

const standing = (
  division: MemberStanding['ladder']['division'],
  over: Partial<MemberStanding> = {},
): MemberStanding => ({
  ladder: { style: 'freestyle', division },
  key: `freestyle:${division}`,
  season: 'Fall 2026',
  current: true,
  rating: null,
  provisional: false,
  hidden: false,
  ...over,
});

/** React escapes apostrophes; the copy is compared as the page reads it. */
const text = (html: string) => html.replaceAll('&#x27;', "'");

describe('RankedLadders', () => {
  test('a youth member: Youth is theirs, Open locked 18 and over with the reason', () => {
    const html = text(
      renderToString(
        <RankedLadders
          standings={[standing('open'), standing('youth', { rating: 1512 })]}
          division="youth"
        />,
      ),
    );
    assert({
      given: 'a member on the Youth ladder rated 1512',
      should:
        'card Youth as their ladder with its rating, and lock Open with the 18th-birthday rule',
      actual: [
        html.indexOf('Youth – Freestyle') < html.indexOf('Open – Freestyle'),
        html.includes('Your ladder'),
        html.includes('>1512<'),
        html.includes(ladderRoomsLine('youth')),
        html.includes('18 and over'),
        html.includes(lockedLadderLine('open')),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('an adult: one Open card and a line that Youth is for under 18', () => {
    const html = text(
      renderToString(
        <RankedLadders
          standings={[
            standing('open', { rating: 1490, provisional: true }),
            standing('youth'),
          ]}
          division="open"
        />,
      ),
    );
    assert({
      given: 'a member on the Open ladder, provisional at 1490',
      should:
        'card Open as theirs, starred and Provisional, with a note that they can still judge Youth',
      actual: [
        html.includes('1490*'),
        html.includes('>Provisional<'),
        html.includes(ladderRoomsLine('open')),
        html.includes('role="note"'),
        html.includes(lockedLadderLine('youth')),
        html.includes('Under 18'),
      ],
      expected: [true, true, true, true, true, false],
    });
  });

  test('a member with no ladder is told why, with no ladder card', () => {
    const html = text(
      renderToString(<RankedLadders standings={[]} division={null} />),
    );
    assert({
      given: 'a member with no age on record',
      should: 'say ranked needs their age, and show no ladder',
      actual: [html.includes(noLadderReason), html.includes('Your ladder')],
      expected: [true, false],
    });
  });
});

describe('rankedLadderView', () => {
  test('a rating kept from last season is no rating this season', () => {
    const view = rankedLadderView(
      [
        standing('youth', {
          current: false,
          rating: 1604,
          season: 'Spring 2026',
        }),
        standing('open'),
      ],
      'youth',
    );
    assert({
      given: 'their own Youth ladder rated only last season',
      should: 'show this season, unrated',
      actual: [view.own.standing, view.own.season],
      expected: [null, 'Fall 2026'],
    });
  });
});

describe('the Ranked page lede', () => {
  test('names the member’s ladder', () => {
    assert({
      given: 'a youth member and an adult',
      should: 'say which ladder they play ranked on',
      actual: [rankedLadderLead('youth'), rankedLadderLead('open')],
      expected: [
        'You play ranked on the Youth ladder: against other members under 18.',
        'You play ranked on the Open ladder.',
      ],
    });
  });
});
