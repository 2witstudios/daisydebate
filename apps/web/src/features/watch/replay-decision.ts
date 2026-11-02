import { isParticipant, type WatchRound, type WatchViewer } from './round';

/** What the viewer gets when they open a recording. */
export type ReplayDecision = 'unavailable' | 'processing' | 'expired' | 'watch';

/**
 * Who may replay. Pure. A missing Round, a Round that has not ended and a
 * private recording the viewer is not seated in are one answer; a public or
 * unlisted recording is open to any account, and then its own state decides.
 */
export function decideReplay(
  round: WatchRound | null,
  viewer: WatchViewer,
): ReplayDecision {
  if (round === null || round.state.status !== 'ended') return 'unavailable';
  if (round.visibility === 'private' && !isParticipant(round, viewer))
    return 'unavailable';
  const { availability } = round.state.recording;
  return availability === 'ready' ? 'watch' : availability;
}
