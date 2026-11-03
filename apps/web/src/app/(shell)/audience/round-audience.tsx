import { claimedUsername } from '@daisy/auth';
import { systemId } from '@daisy/clock';
import { requestAudience, requestIdentity } from '../../../lib/request-session';
import { accountOf } from '../../../features/access/account-of';
import { AudiencePanel } from '../../../ui/audience/audience-panel';
import { audienceViewerOf } from '../../../ui/audience/audience-viewer';
import { ViewerPulse } from '../../../ui/audience/viewer-pulse';
import { WatchedMark } from '../../../ui/audience/watched-mark';
import {
  postSpectatorChatAction,
  reactToRoundAction,
  reportFromPageAction,
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
  const principal = accountOf(identity);
  const audience = await requestAudience(roundId, principal?.actorId ?? null);
  if (!audience) return null;
  const target = { roundId, returnTo };
  const viewer = audienceViewerOf({
    account: principal,
    usernameClaimed: principal !== null && claimedUsername(identity) !== null,
    inLiveRoom: audience.inLiveRoom,
    returnTo,
    requestId: () => systemId.next(),
    actions: {
      react: reactToRoundAction.bind(null, target),
      reportMessage: reportFromPageAction.bind(null, returnTo),
      postChat: postSpectatorChatAction.bind(null, target),
    },
  });
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
