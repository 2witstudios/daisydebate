import { ladderCopyInView } from '../test-support/ladder-copy.test-support';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { noLadderReason } from '../../features/play/ladder-division-words';
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

describe('RankedLadders', () => {
  test('one Rating, naming no ladder, style or division (YRanked, generic copy)', () => {
    const youth = renderAccessible(
      <RankedLadders
        standings={[standing('open'), standing('youth', { rating: 1512 })]}
        division="youth"
      />,
    );
    const youthFacts = [
      youth.has('link', 'Rating'),
      youth.textContent().includes('Fall 2026'),
      youth.textContent().includes('1512'),
    ];
    const youthCopy = ladderCopyInView(youth);
    const youthText = youth.textContent();
    const youthItems = youth.count('listitem');
    const adult = renderAccessible(
      <RankedLadders
        standings={[
          standing('open', { rating: 1490, provisional: true }),
          standing('youth'),
        ]}
        division="open"
      />,
    );
    const adultText = adult.textContent();
    assert({
      given: 'a youth member rated 1512 and an adult provisional at 1490',
      should:
        'show one Rating card each with the season and rating, and no ladder, style or division copy',
      actual: [
        ...youthFacts,
        adultText.includes('1490*'),
        adultText.includes('Provisional'),
        youthCopy !== null ||
          ladderCopyInView(adult) !== null ||
          [youthText, adultText].some(
            (text) =>
              text.includes('Youth') ||
              text.includes('Open') ||
              text.includes('Your ladder'),
          ),
        youthItems,
      ],
      expected: [true, true, true, true, true, false, 1],
    });
  });

  test('no age on record', () => {
    const view = renderAccessible(
      <RankedLadders standings={[]} division={null} />,
    );
    assert({
      given: 'a member with no age on record',
      should: 'show the age prompt',
      actual: view.textContent().includes(noLadderReason),
      expected: true,
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
      given: 'their own ladder rated only last season',
      should: 'show this season, unrated',
      actual: [view.standing, view.season],
      expected: [null, 'Fall 2026'],
    });
  });
});
