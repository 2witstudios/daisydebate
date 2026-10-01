import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  NOW,
  liveRoom,
  openRoom,
} from '../../../features/lobby/room.test-support';
import { RoomRow } from './room-row';

setupRitewayBun();

const viewer = { rating: 1400 };
const render = (room: Parameters<typeof RoomRow>[0]['room']) =>
  renderToString(h(RoomRow, { room, viewer, now: NOW }));

describe('RoomRow', () => {
  test('an open ranked table the viewer fits', () => {
    const html = render(
      openRoom({
        name: 'Tuesday night',
        host: { handle: 'host-one', rating: 1512 },
        band: { min: 1300, max: 1700 },
        waitingSince: '2026-09-30T11:58:00.000Z',
      }),
    );
    assert({
      given: 'an open ranked table with a 1300–1700 band',
      should: 'show name, mode, rules, host, open seat with band and wait',
      actual: [
        html.includes('Tuesday night'),
        html.includes('Ranked'),
        html.includes('Standard rules'),
        html.includes('@host-one'),
        html.includes('1512'),
        html.includes('Open seat'),
        html.includes('1300–1700'),
        html.includes('Waiting 2 min'),
      ],
      expected: [true, true, true, true, true, true, true, true],
    });
    assert({
      given: 'the same table',
      should: 'offer one enabled Take seat link to /play',
      actual: [
        /<a [^>]*href="\/play"[^>]*>Take seat<\/a>/.test(html),
        html.includes('disabled=""'),
        html.split('<a ').length - 1,
      ],
      expected: [true, false, 1],
    });
  });

  test('the rules label shows on every width', () => {
    const html = render(
      openRoom({ mode: 'casual', customRules: true }),
    ).replaceAll('<!-- -->', '');
    assert({
      given: 'a casual table with custom rules',
      should: 'name mode and rules in one line that is never hidden',
      actual: [
        html.includes('Casual</span> · Custom rules'),
        html.includes('max-compact:hidden'),
      ],
      expected: [true, false],
    });
  });

  test('a ranked table whose band excludes the viewer', () => {
    const html = render(
      openRoom({ mode: 'ranked', band: { min: 1600, max: 1800 } }),
    );
    assert({
      given: 'a ranked table accepting 1600–1800 and a 1400 viewer',
      should: 'render Take seat as a disabled button, not a link',
      actual: [
        /<button [^>]*disabled=""[^>]*>Take seat<\/button>/.test(html),
        html.includes('<a '),
        html.includes('your rating is outside 1600–1800'),
      ],
      expected: [true, false, true],
    });
  });

  test('a casual custom-rules table', () => {
    const html = render(
      openRoom({
        mode: 'casual',
        customRules: true,
        band: { min: null, max: null },
      }),
    );
    assert({
      given: 'a casual table with custom rules and any rating',
      should: 'say Casual, Custom rules and any rating',
      actual: [
        html.includes('Casual'),
        html.includes('Custom rules'),
        html.includes('any rating'),
      ],
      expected: [true, true, true],
    });
  });

  test('a live room', () => {
    const html = render(
      liveRoom({
        watching: 14,
        host: { handle: 'debater-a', rating: 1620 },
        opponent: { handle: 'debater-b', rating: 1588 },
      }),
    );
    assert({
      given: 'a live room watched by 14',
      should: 'show both players, the audience and one Spectate link to /watch',
      actual: [
        html.includes('@debater-a'),
        html.includes('1620'),
        html.includes('@debater-b'),
        html.includes('1588'),
        html.includes('14 watching'),
        html.includes('Open seat'),
        /<a [^>]*href="\/watch"[^>]*>Spectate<\/a>/.test(html),
      ],
      expected: [true, true, true, true, true, false, true],
    });
  });
});
