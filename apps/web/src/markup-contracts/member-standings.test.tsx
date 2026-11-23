import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { MemberStandings } from '../ui/ranked/member-standings';

setupRitewayBun();

/**
 * A ladder chip was a plum-toned badge with no role or name of its own; only
 * its colour class shows whether one is drawn.
 */
describe('MemberStandings markup', () => {
  test('a season history names no ladder', () => {
    const html = renderMarkup(
      <MemberStandings
        standings={[
          {
            ladder: { style: 'freestyle', division: 'open' },
            key: 'freestyle:open',
            season: 'Fall 2026',
            current: true,
            rating: 1500,
            provisional: true,
            hidden: false,
          },
        ]}
        seasonHistory={[
          {
            key: 'freestyle:youth:s1',
            ladder: { style: 'freestyle', division: 'youth' },
            season: 'Spring 2026',
            rating: 1604,
            provisional: false,
            rank: 12,
            of: 388,
            wins: 31,
            losses: 12,
          },
        ]}
      />,
    );
    assert({
      given: 'a provisional rating now and a Youth season finished before',
      should: 'draw no plum ladder chip',
      actual: html.includes('text-hue-plum'),
      expected: false,
    });
  });
});
