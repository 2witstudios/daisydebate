import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
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
