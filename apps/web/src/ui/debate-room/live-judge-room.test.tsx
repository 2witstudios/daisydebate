import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { LiveJudgeRoom } from './live-judge-room';
import { view } from './live-round.test-support';
setupRitewayBun();
test('an assigned judge watches debaters without competitive controls or attendance', () => {
  const html = renderToStaticMarkup(
    <LiveJudgeRoom
      view={view}
      read={async () => ({ kind: 'found', round: view })}
      socketUrl={null}
    />,
  );
  assert({
    given:
      'the server-authorized own judge assignment and anonymous judge projection',
    should:
      'mount real media, link the native ballot and omit attendance, commands and judge tiles',
    actual: [
      html.includes('aria-label="Live camera and sound"'),
      html.includes(`/judge/ballot/${view.id}`),
      html.includes('<form'),
      html.includes('Check in'),
      html.includes('Your camera'),
      html.includes('Riley Judge'),
    ],
    expected: [true, true, false, false, false, false],
  });
});
