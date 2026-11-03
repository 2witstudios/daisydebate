import type { Identity } from '@daisy/auth';
import type { RecordingViewer } from './audience';

/** Who is asking. Watching needs no account; only a member can be anyone else. */
export const recordingViewerOf = (identity: Identity): RecordingViewer =>
  identity.state === 'member' && identity.principal.actorId !== null
    ? {
        kind: 'account',
        userId: identity.principal.userId,
        actorId: identity.principal.actorId,
      }
    : { kind: 'visitor' };
