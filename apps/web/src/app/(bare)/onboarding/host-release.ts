import {
  requestIdentity,
  requestReleaseEnabled,
} from '../../../lib/request-session';

/**
 * Whether the intro may point a member at Daisy Tab's hosting tools: the
 * same `daisy-tab` release the Tab routes gate on, read for this member.
 * The intro reads only the flag, never a Tab module, so its pages stay
 * outside Tab's route groups.
 */
export async function requestHostToolsReleased(): Promise<boolean> {
  const identity = await requestIdentity();
  return requestReleaseEnabled(
    'daisy-tab',
    identity.state === 'member' ? identity.principal.userId : null,
  );
}
