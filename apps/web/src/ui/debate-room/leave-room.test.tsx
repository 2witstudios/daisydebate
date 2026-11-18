import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { LeaveRoom, type LeaveLinks } from './leave-room';

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
  const freed = renderToString(
    h(LeaveRoom, { links: { ...links, freed: true } }),
  );
  const plain = renderToString(h(LeaveRoom, { links }));
  assert({
    given:
      'the Leave confirm for a debater whose Round awaits its ballot, and for anyone else',
    should:
      'say leaving forfeits nothing, promise no judging, and offer a plain leave link, only for that debater',
    actual: [
      freed.includes(FREED),
      freed.includes('href="/lobby"'),
      freed.includes('forfeits the round'),
      /judging/i.test(freed),
      plain.includes(FREED),
    ],
    expected: [true, true, false, false, false],
  });
});

test('on a post-round call the control leaves the call, forfeiting nothing', () => {
  const call = renderToString(
    h(LeaveRoom, { links: { ...links, freed: true, call: true } }),
  );
  const round = renderToString(h(LeaveRoom, { links }));
  assert({
    given: 'the Leave confirm during a post-round call, and during a Round',
    should: 'name the call, promise no forfeit, and never say Leave round',
    actual: [
      call.includes('Leave call'),
      call.includes('Leave the call?'),
      call.includes('The round is over, so leaving forfeits nothing.'),
      call.includes('Leave round'),
      round.includes('Leave round'),
      round.includes('Leave call'),
    ],
    expected: [true, true, true, false, true, false],
  });
});

test('a held Round cannot trap a debater: the seat is kept and the lobby stays reachable', () => {
  const held = renderToString(
    h(LeaveRoom, {
      links: {
        ...links,
        held: true,
        left: { actorId: 'a1', roomId: 'room-1', roundId: 'r1' },
      },
    }),
  );
  assert({
    given: 'the Leave confirm while the Round catches up',
    should:
      'say leaving is unavailable and what stepping away means, and send no forfeit command',
    actual: [
      held.includes('Leaving is unavailable for a moment'),
      held.includes('keeping your seat'),
      held.includes('the round continues'),
      held.includes('attendance rules apply'),
      held.includes('Leave and forfeit'),
      held.includes('<form'),
      held.includes('commandId'),
    ],
    expected: [true, true, true, true, false, false, false],
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
    renderToString(
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
  const forfeit = withdrawal();
  assert({
    given:
      'the Leave confirm in a Round no forfeit ends, then in a two-sided Round',
    should:
      'post leave and say the seat is recorded absent, where the two-sided Round still forfeits',
    actual: [
      leave.includes('name="type" value="leave"'),
      leave.includes('your seat is recorded absent'),
      leave.includes('forfeit'),
      forfeit.includes('name="type" value="forfeit"'),
      forfeit.includes('Leave and forfeit'),
    ],
    expected: [true, true, false, true, true],
  });
});
