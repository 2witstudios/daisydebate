import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import type { LeaveLinks } from './leave-room';
import { RoundBar } from './round-bar';

setupRitewayBun();

/** RoundBar's leave shape; the badge test never renders its links. */
const noLeave: LeaveLinks = {
  confirming: false,
  stayHref: '',
  confirmHref: '?leave',
  leaveHref: '/lobby',
};

describe('RoundBar', () => {
  test('the unread badge on the closed drawer', () => {
    const html = renderToString(
      h(RoundBar, {
        round: sampleRound('opponent-speaking', 'casual'),
        drawerOpen: false,
        unread: 3,
        onToggleDrawer: () => {},
        leave: noLeave,
      }),
    );
    assert({
      given: 'a closed drawer with unread chat',
      should: 'badge the toggle at the 12px floor like the drawer badge',
      actual: [html.includes('>3<'), html.includes('text-2xs')],
      expected: [true, false],
    });
  });
});

describe('RoundBar vocabulary', () => {
  const bar = (roomNumber?: number) =>
    renderToString(
      h(RoundBar, {
        round: sampleRound('opponent-speaking', 'casual'),
        ...(roomNumber === undefined ? {} : { roomNumber }),
        drawerOpen: true,
        unread: 0,
        onToggleDrawer: () => {},
        leave: noLeave,
      }),
    );

  test('the resolution is labelled and the live speech reads by its full name', () => {
    const round = sampleRound('opponent-speaking', 'casual');
    const live = round.speeches[round.liveIndex]!;
    const html = bar();
    assert({
      given: 'a debater on the affirmative while the negative speaks',
      should:
        'label the resolution, name the live speech in full, and say which side the viewer is on',
      actual: [
        html.includes('Resolution'),
        html.includes(round.resolution),
        html.includes(`${live.code} · ${live.name}`),
        html.includes(
          round.self.side === 'aff' ? 'You’re Affirmative' : 'You’re Negative',
        ),
        html.includes('aria-label="Speech order"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('a room number shows only when the round carries one', () => {
    assert({
      given: 'no room number, then room 4',
      should: 'render nothing, then Room 4',
      actual: [bar().includes('Room 4'), bar(4).includes('Room 4 · ')],
      expected: [false, true],
    });
  });
});
