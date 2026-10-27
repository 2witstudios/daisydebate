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

const FREED =
  'The debate is over, so leaving forfeits nothing. Your result arrives once the judging is done.';

test('a debater leaving while the ballot is pending is told they are freed (ISSUE-590)', () => {
  const freed = renderToString(
    h(LeaveRoom, { links: { ...links, freed: true } }),
  );
  const plain = renderToString(h(LeaveRoom, { links }));
  assert({
    given:
      'the Leave confirm for a debater whose Round awaits its ballot, and for anyone else',
    should:
      'say leaving forfeits nothing and the result follows, with a plain leave link, only for that debater',
    actual: [
      freed.includes(FREED),
      freed.includes('href="/lobby"'),
      freed.includes('forfeits the round'),
      plain.includes(FREED),
    ],
    expected: [true, true, false, false],
  });
});
