import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';
import { judge, view } from './live-round.test-support';

setupRitewayBun();
await mockNextRouter();
const { LiveJudgeRoom } = await import('./live-judge-room');
const { roundEnded } = await import('./round-ended');

test('which Rounds have ended', () => {
  assert({
    given: 'each Round status',
    should: 'end only completed and abandoned Rounds',
    actual: ['scheduled', 'active', 'completed', 'abandoned'].map(roundEnded),
    expected: [false, false, true, true],
  });
});

test('a live room whose Round completed points to its result', () => {
  const ended = {
    ...view,
    status: 'completed' as const,
    participants: [
      ...view.participants.filter((seat) => seat.role !== 'judge'),
      judge,
    ],
  };
  const html = renderToStaticMarkup(
    <LiveJudgeRoom
      view={ended}
      read={async () => ({ kind: 'found', round: ended })}
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
