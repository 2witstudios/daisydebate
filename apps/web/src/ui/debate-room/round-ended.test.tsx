import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { asCompleted, judge, view } from './live-round.test-support';

setupRitewayBun();
await mockNextRouter();
const { LiveJudgeRoom } = await import('../judging-room/live-judge-room');

test('a live room whose Round completed points to its result', () => {
  const ended = {
    ...asCompleted(view),
    participants: [
      ...view.participants.filter((seat) => seat.seat.kind !== 'judge'),
      judge,
    ],
  };
  const page = renderAccessible(
    <LiveJudgeRoom
      renderedAtMs={0}
      actorId="a"
      view={ended}
      read={async () => ({
        kind: 'found',
        round: ended,
        serverNowMs: null,
        socketUrl: null,
      })}
      socketUrl={null}
    />,
  );
  assert({
    given: 'a judge’s live room once the Round completes',
    should: 'say the round is over and link its result page, without media',
    actual: [
      page.textContent().includes('This round is over.'),
      page.all('link').map((link) => link.getAttribute('href')),
      page.has('region', 'Live camera and sound'),
    ],
    expected: [true, [`/rounds/${view.id}`], false],
  });
});
