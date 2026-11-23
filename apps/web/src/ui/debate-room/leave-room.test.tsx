import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { LeaveRoom, type LeaveLinks } from './leave-room';
import { postedBy, postsAnyForm } from './posted-fields.test-support';

setupRitewayBun();

const links: LeaveLinks = {
  confirming: true,
  stayHref: '/rounds/r1/room',
  confirmHref: '/rounds/r1/room?leave',
  leaveHref: '/lobby',
};

// Every Round, judged or not: a zero-judge Round has no judging to wait for.
const FREED = 'The debate is over, so leaving forfeits nothing.';

test('a debater leaving while the ballot is pending is told they are freed (ISSUE-590)', () => {
  const freed = renderAccessible(
    h(LeaveRoom, { links: { ...links, freed: true } }),
  ).within('dialog', 'Leave the round?');
  // A view reads the latest render only, so read each before the next.
  const freedFacts = [
    freed.textContent().includes(FREED),
    freed.attribute('link', 'Leave round', 'href'),
    freed.textContent().includes('forfeits the round'),
    /judging/i.test(freed.textContent()),
  ];
  const plain = renderAccessible(h(LeaveRoom, { links }));
  assert({
    given:
      'the Leave confirm for a debater whose Round awaits its ballot, and for anyone else',
    should:
      'say leaving forfeits nothing, promise no judging, and offer a plain leave link, only for that debater',
    actual: [...freedFacts, plain.textContent().includes(FREED)],
    expected: [true, '/lobby', false, false, false],
  });
});

test('on a post-round call the control leaves the call, forfeiting nothing', () => {
  const call = renderAccessible(
    h(LeaveRoom, { links: { ...links, freed: true, call: true } }),
  );
  const callText = call.textContent();
  const callFacts = [
    call.count('link', 'Leave call'),
    call.has('dialog', 'Leave the call?'),
  ];
  const round = renderAccessible(h(LeaveRoom, { links }));
  const roundText = round.textContent();
  assert({
    given: 'the Leave confirm during a post-round call, and during a Round',
    should: 'name the call, promise no forfeit, and never say Leave round',
    actual: [
      ...callFacts,
      callText.includes('The round is over, so leaving forfeits nothing.'),
      callText.includes('Leave round'),
      round.count('link', 'Leave round'),
      roundText.includes('Leave call'),
    ],
    expected: [2, true, true, false, 2, false],
  });
});

test('a held Round cannot trap a debater: the seat is kept and the lobby stays reachable', () => {
  const held = renderAccessible(
    h(LeaveRoom, {
      links: {
        ...links,
        held: true,
        left: { actorId: 'a1', roomId: 'room-1', roundId: 'r1' },
      },
    }),
  );
  const text = held.within('dialog', 'Leave the round?').textContent();
  assert({
    given: 'the Leave confirm while the Round catches up',
    should:
      'say leaving is unavailable and what stepping away means, and send no forfeit command',
    actual: [
      text.includes('Leaving is unavailable for a moment'),
      held.has('link', 'Go to the lobby, keeping your seat'),
      text.includes('the round continues'),
      text.includes('attendance rules apply'),
      held.textContent().includes('Leave and forfeit'),
      postsAnyForm(held),
    ],
    expected: [true, true, true, true, false, false],
  });
});

test('leaving a Round no forfeit ends posts leave and says the Round goes on (TAB-6.8)', () => {
  const noop = () => {};
  const router = {
    bfcacheId: 'test',
    back: noop,
    forward: noop,
    refresh: noop,
    push: noop,
    replace: noop,
    prefetch: noop,
  };
  const withdrawal = (type?: 'leave') =>
    renderAccessible(
      h(
        AppRouterContext,
        { value: router },
        h(LeaveRoom, {
          links: {
            ...links,
            forfeit: {
              action: (async (state: unknown) => state) as never,
              commandId: 'c'.repeat(24),
              expectedVersion: 3,
              participantId: 'p'.repeat(24),
              ...(type ? { type } : {}),
            },
          },
        }),
      ),
    );
  const leave = withdrawal('leave');
  const leaveFacts = [
    postedBy(leave, 'Leave round').type,
    leave.textContent().includes('your seat is recorded absent'),
    leave.textContent().includes('forfeit'),
  ];
  const forfeit = withdrawal();
  assert({
    given:
      'the Leave confirm in a Round no forfeit ends, then in a two-sided Round',
    should:
      'post leave and say the seat is recorded absent, where the two-sided Round still forfeits',
    actual: [
      ...leaveFacts,
      postedBy(forfeit, 'Leave and forfeit').type,
      forfeit.has('button', 'Leave and forfeit'),
    ],
    expected: ['leave', true, false, 'forfeit', true],
  });
});
