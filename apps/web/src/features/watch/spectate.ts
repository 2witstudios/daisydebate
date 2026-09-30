import { isParticipant, type WatchDebate, type WatchViewer } from './debate';

/** What the viewer gets when they open a debate's live view. */
export type SpectateDecision =
  | 'signed-out'
  | 'unavailable'
  | 'conflict'
  | 'revoked'
  | 'upcoming'
  | 'full'
  | 'watch';

/**
 * Who may watch. Pure: the debate (or null when there is none) and the
 * viewer decide, in this order, so a refusal never tells more than it must.
 * Signed-out viewers learn nothing about the debate; a private or missing
 * debate is one answer; a debater or judge never spectates their own debate.
 */
export function decideSpectate(
  debate: WatchDebate | null,
  viewer: WatchViewer,
): SpectateDecision {
  if (!viewer.signedIn) return 'signed-out';
  if (debate === null || debate.visibility === 'private') return 'unavailable';
  if (isParticipant(debate, viewer)) return 'conflict';
  if (debate.removedSpectators.includes(viewer.handle)) return 'revoked';
  if (debate.state.status === 'upcoming') return 'upcoming';
  if (debate.state.status === 'live' && debate.audienceFull) return 'full';
  return 'watch';
}
