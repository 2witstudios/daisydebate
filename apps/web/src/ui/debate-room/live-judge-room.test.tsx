import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../lib/testing/mock-router';
import { view, judge } from './live-round.test-support';
setupRitewayBun();
await mockNextRouter();
const { LiveJudgeRoom } = await import('./live-judge-room');
test('an assigned judge watches debaters without competitive controls or attendance', () => {
  const assignedView = {
    ...view,
    participants: [
      ...view.participants.filter((seat) => seat.role !== 'judge'),
      judge,
    ],
  };
  const html = renderToStaticMarkup(
    <LiveJudgeRoom
      view={assignedView}
      read={async () => ({ kind: 'found', round: assignedView })}
      socketUrl={null}
    />,
  );
  assert({
    given:
      'the private own-assignment view includes the caller’s named human judge seat',
    should:
      'mount real media, link the native ballot, label the resolution and omit attendance, commands and judge tiles',
    actual: [
      html.includes('aria-label="Live camera and sound"'),
      html.includes(`/judge/ballot/${view.id}`),
      html.includes('<form'),
      html.includes('Check in'),
      html.includes('Your camera'),
      html.includes('Riley Judge'),
      html.includes('>Resolution</h2>'),
      html.match(/<figure/g)?.length,
    ],
    expected: [true, true, false, false, false, false, true, 2],
  });
});
