import type { WatchRound, WatchViewer } from './round';
import {
  roundContext,
  roundSchedule,
  findRound,
  replayDensity,
} from './round-source';
import { buildReplayView, type ReplayView } from './replay-build';
import { decideReplay } from './replay-decision';
import type { ReplayQuery } from './replay-query';

/** Everything the replay route can render, one variant per screen. */
export type ReplayScreen =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'processing' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'watch'; readonly view: ReplayView };

type Ended = WatchRound & {
  readonly state: Extract<WatchRound['state'], { status: 'ended' }>;
};

const isEnded = (round: WatchRound | null): round is Ended =>
  round !== null && round.state.status === 'ended';

/**
 * The replay route's one flow driver: the recording id and the viewer decide
 * the screen. Today it reads the sample Rounds; the backend read of a
 * recording and its transcript replace `findDebate` and `debateSchedule`.
 */
export function openReplay(
  id: string,
  viewer: WatchViewer,
  query: ReplayQuery,
): ReplayScreen {
  const round = findRound(id);
  const decision = decideReplay(round, viewer);
  if (decision !== 'watch' || !isEnded(round)) {
    return { kind: decision === 'watch' ? 'unavailable' : decision };
  }
  return {
    kind: 'watch',
    view: buildReplayView({
      round,
      viewer,
      query,
      table: roundSchedule(round),
      density: replayDensity(round),
      context: roundContext(round),
    }),
  };
}
