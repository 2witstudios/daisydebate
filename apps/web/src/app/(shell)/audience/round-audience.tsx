import { claimedUsername } from '@daisy/auth';
import { systemId } from '@daisy/clock';
import { requestAudience, requestIdentity } from '../../../lib/request-session';
import {
  AudiencePanel,
  type AudienceViewer,
} from '../../../ui/audience/audience-panel';
import { ViewerPulse } from '../../../ui/audience/viewer-pulse';
import { WatchedMark } from '../../../ui/audience/watched-mark';
import {
  postSpectatorChatAction,
  reactToRoundAction,
  reportChatMessageAction,
} from './actions';

/**
 * What a viewer page mounts for a Round's audience: reads, actions and the panel
 * in one server component (SPECT-1.4). `returnTo` is the page a form comes back
 * to. Null when the Round has no audience. A seat is never counted as a viewer.
 */
export async function RoundAudience({
  roundId,
  returnTo,
}: {
  readonly roundId: string;
  readonly returnTo: string;
}) {
  const identity = await requestIdentity();
  const signedIn = identity.state !== 'anonymous' && 'principal' in identity;
  const principal =
    signedIn && identity.principal.kind === 'user' ? identity.principal : null;
  const audience = await requestAudience(roundId, principal?.actorId ?? null);
  if (!audience) return null;
  const target = { roundId, returnTo };
  const react = reactToRoundAction.bind(null, target);
  const reportMessage = reportChatMessageAction.bind(null, returnTo);
  const viewer: AudienceViewer =
    principal === null
      ? {
          kind: 'visitor',
          signInHref: `/sign-in?next=${encodeURIComponent(returnTo)}`,
        }
      : principal.actorId === null || !claimedUsername(identity)
        ? { kind: 'needs-username' }
        : audience.inLiveRoom
          ? { kind: 'live-room', react, reportMessage }
          : {
              kind: 'account',
              requestId: systemId.next(),
              postChat: postSpectatorChatAction.bind(null, target),
              react,
              reportMessage,
            };
  return (
    <>
      {audience.seated ? null : (
        <ViewerPulse roundId={roundId} unlisted={audience.unlisted} />
      )}
      {principal ? <WatchedMark roundId={roundId} /> : null}
      <AudiencePanel
        initial={audience.snapshot}
        viewer={viewer}
        shown={audience.shown}
        unlisted={audience.unlisted}
      />
    </>
  );
}
