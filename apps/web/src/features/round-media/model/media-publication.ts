import { admissionReconnects, type MediaState } from './media-state';

/**
 * What this device's microphone is actually doing, for the Round controls. Permission
 * to speak stays the server's grant; this is the evidence (ISSUE-881).
 */
export type LocalPublication =
  'published' | 'muted' | 'ill' | 'disconnected' | 'absent' | null;

export function publicationOf(state: MediaState): LocalPublication {
  const { link } = state;
  switch (link.phase) {
    case 'waiting':
    case 'ended':
      return null;
    case 'released':
      return link.why === 'transient' ? 'ill' : 'disconnected';
    case 'admitting':
      return admissionReconnects(link) ? 'ill' : null;
    case 'connecting':
      return link.reconnecting ? 'ill' : null;
    case 'live': {
      const { establishment } = link;
      if (establishment.stage === 'establishing')
        return establishment.reconnecting ? 'ill' : null;
      const granted = establishment.media.grants.publish.includes('microphone');
      const own = link.tracks.find(
        (track) => track.local && track.source === 'microphone',
      );
      if (own) return own.muted ? 'muted' : 'published';
      return granted ? 'absent' : null;
    }
  }
}
