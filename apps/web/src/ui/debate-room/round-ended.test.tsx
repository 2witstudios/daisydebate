import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';
import { asCompleted, judge, view } from './live-round.test-support';

setupRitewayBun();
await mockNextRouter();
const { LiveJudgeRoom } = await import('../judging-room/live-judge-room');

test('a live room whose Round completed points to its result', () => {
  const ended = {
    ...asCompleted(view),
    participants: [
      ...view.participants.filter((seat) => seat.role !== 'judge'),
      judge,
    ],
  };
  const html = renderToStaticMarkup(
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
      html.includes('This round is over.'),
      html.includes(`href="/rounds/${view.id}"`),
      html.includes('aria-label="Live camera and sound"'),
    ],
    expected: [true, true, false],
  });
});
