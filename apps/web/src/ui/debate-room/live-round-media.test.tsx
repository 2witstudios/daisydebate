import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundCommandIds } from '../../features/round-runtime/command-ids';
import { LiveRoundRoom } from './live-round-room';
import { aff, view, origin } from './live-round.test-support';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
setupRitewayBun();
const noop = () => {};
test('the canonical live Round mounts its media session and truthful native fallback', () => {
  const html = renderToStaticMarkup(
    <AppRouterContext
      value={{
        bfcacheId: 'test',
        back: noop,
        forward: noop,
        refresh: noop,
        push: noop,
        replace: noop,
        prefetch: noop,
      }}
    >
      <LiveRoundRoom
        view={view}
        actorId={aff.actorId}
        renderedAtMs={origin}
        commandIds={roundCommandIds(() => 'c'.repeat(24))}
        commandAction={async () => ({ values: {} })}
        socketUrl={null}
        read={async () => ({ kind: 'found', round: view, socketUrl: null })}
        leave={{
          confirming: false,
          stayHref: '/stay',
          confirmHref: '/confirm',
          leaveHref: '/lobby',
        }}
      />
    </AppRouterContext>,
  );
  assert({
    given: 'the fresh canonical debater view without an injected media slot',
    should:
      'render the actual media session and explain native availability without exposing a judge',
    actual: [
      html.includes('aria-label="Live camera and sound"'),
      html.includes('Live camera and sound require JavaScript.'),
      html.includes('Riley Judge'),
    ],
    expected: [true, true, false],
  });
});
