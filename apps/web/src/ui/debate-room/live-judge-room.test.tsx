import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { LiveJudgeRoom } from './live-judge-room';
import { view, judge } from './live-round.test-support';
setupRitewayBun();
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
      'mount real media, link the native ballot and omit attendance, commands and judge tiles',
    actual: [
      html.includes('aria-label="Live camera and sound"'),
      html.includes(`/judge/ballot/${view.id}`),
      html.includes('<form'),
      html.includes('Check in'),
      html.includes('Your camera'),
      html.includes('Riley Judge'),
      html.match(/<figure/g)?.length,
    ],
    expected: [true, true, false, false, false, false, 2],
  });
});
