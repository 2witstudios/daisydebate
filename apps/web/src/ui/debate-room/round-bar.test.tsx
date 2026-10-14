import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleRound } from '../mock/debate-room';
import type { LeaveLinks } from './leave-room';
import { RoundBar } from './round-bar';

setupRitewayBun();

/** The links the badge test never renders. */
const noLeave: LeaveLinks = { confirming: false, stayHref: '' };

describe('RoundBar', () => {
  test('the unread badge on the closed drawer', () => {
    const html = renderToString(
      h(RoundBar, {
        round: sampleRound('opponent-speaking', 'practice'),
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
