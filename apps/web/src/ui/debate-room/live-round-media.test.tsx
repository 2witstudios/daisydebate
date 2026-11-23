import { idle } from '../../features/forms/form-state';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundCommandIds } from '../../features/round-runtime/command-ids';
import { LiveRoundRoom } from './live-round-room';
import { aff, view, origin } from './live-round.test-support';
import { postedBy } from './posted-fields.test-support';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
setupRitewayBun();
const noop = () => {};
test('the canonical live Round mounts its media session and truthful native fallback', () => {
  const page = renderAccessible(
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
        principalId="principal"
        renderedAtMs={origin}
        commandIds={roundCommandIds(() => 'c'.repeat(24))}
        commandAction={async () => idle()}
        socketUrl={null}
        read={async () => ({
          kind: 'found',
          round: view,
          serverNowMs: null,
          socketUrl: null,
        })}
        leave={{
          confirming: false,
          stayHref: '/stay',
          confirmHref: '/confirm',
          leaveHref: '/lobby',
        }}
        leaveAction={async () => idle()}
      />
    </AppRouterContext>,
  );
  // Leave's confirm is a closed dialog until opened: its form is there, hidden.
  const forfeit = postedBy(page, 'Leave and forfeit', { hidden: true });
  assert({
    given: 'the fresh canonical debater view without an injected media slot',
    should:
      'render the actual media session without exposing a judge, and make Leave the confirmed forfeit',
    actual: [
      page.has('region', 'Live camera and sound'),
      page.textContent().includes('Riley Judge'),
      forfeit.type,
      forfeit.participantId,
    ],
    expected: [true, false, 'forfeit', aff.id],
  });
});
