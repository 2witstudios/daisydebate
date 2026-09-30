import { isParticipant, type WatchDebate, type WatchViewer } from './debate';

/** What the viewer gets when they open a recording. */
export type ReplayDecision = 'unavailable' | 'processing' | 'expired' | 'watch';

/**
 * Who may replay. Pure. A missing debate, a debate that has not ended and a
 * private recording the viewer is not seated in are one answer; a public or
 * unlisted recording is open to any account, and then its own state decides.
 */
export function decideReplay(
  debate: WatchDebate | null,
  viewer: WatchViewer,
): ReplayDecision {
  if (debate === null || debate.state.status !== 'ended') return 'unavailable';
  if (debate.visibility === 'private' && !isParticipant(debate, viewer))
    return 'unavailable';
  const { availability } = debate.state.recording;
  return availability === 'ready' ? 'watch' : availability;
}
