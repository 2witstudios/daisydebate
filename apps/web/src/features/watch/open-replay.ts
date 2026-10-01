import type { WatchDebate, WatchViewer } from './debate';
import {
  debateContext,
  debateSchedule,
  findDebate,
  replayDensity,
} from './debate-source';
import { buildReplayView, type ReplayView } from './replay-build';
import { decideReplay } from './replay-decision';
import type { ReplayQuery } from './replay-query';

/** Everything the replay route can render, one variant per screen. */
export type ReplayScreen =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'processing' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'watch'; readonly view: ReplayView };

type Ended = WatchDebate & {
  readonly state: Extract<WatchDebate['state'], { status: 'ended' }>;
};

const isEnded = (debate: WatchDebate | null): debate is Ended =>
  debate !== null && debate.state.status === 'ended';

/**
 * The replay route's one flow driver: the recording id and the viewer decide
 * the screen. Today it reads the sample debates; the backend read of a
 * recording and its transcript replace `findDebate` and `debateSchedule`.
 */
export function openReplay(
  id: string,
  viewer: WatchViewer,
  query: ReplayQuery,
): ReplayScreen {
  const debate = findDebate(id);
  const decision = decideReplay(debate, viewer);
  if (decision !== 'watch' || !isEnded(debate)) {
    return { kind: decision === 'watch' ? 'unavailable' : decision };
  }
  return {
    kind: 'watch',
    view: buildReplayView({
      debate,
      viewer,
      query,
      table: debateSchedule(debate),
      density: replayDensity(debate),
      context: debateContext(debate),
    }),
  };
}
