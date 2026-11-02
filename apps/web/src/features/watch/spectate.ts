import { isParticipant, type WatchRound, type WatchViewer } from './round';

/** What the viewer gets when they open a Round's live view. */
export type SpectateDecision =
  | 'signed-out'
  | 'unavailable'
  | 'conflict'
  | 'revoked'
  | 'upcoming'
  | 'full'
  | 'watch';

/**
 * Who may watch. Pure: the Round (or null when there is none) and the
 * viewer decide, in this order, so a refusal never tells more than it must.
 * Signed-out viewers learn nothing about the Round; a private or missing
 * Round is one answer; a debater or judge never spectates their own Round.
 */
export function decideSpectate(
  round: WatchRound | null,
  viewer: WatchViewer,
): SpectateDecision {
  if (!viewer.signedIn) return 'signed-out';
  if (round === null || round.visibility === 'private') return 'unavailable';
  if (isParticipant(round, viewer)) return 'conflict';
  if (round.removedSpectators.includes(viewer.handle)) return 'revoked';
  if (round.state.status === 'upcoming') return 'upcoming';
  if (round.state.status === 'live' && round.audienceFull) return 'full';
  return 'watch';
}
