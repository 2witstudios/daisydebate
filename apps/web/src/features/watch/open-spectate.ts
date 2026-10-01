import {
  debateSchedule,
  debateContext,
  findDebate,
  spectatorSocial,
} from './debate-source';
import type { WatchDebate, WatchViewer } from './debate';
import { decideSpectate } from './spectate';
import type { SpectateQuery } from './spectate-query';
import { buildSpectateView, type SpectateView } from './spectate-view';
import { signInToWatchHref, watchRoutes } from './routes';

/** A debate's headline, shown to a signed-out visitor to invite them in. */
type Teaser = {
  readonly title: string;
  readonly modeLabel: string;
  readonly watching: number;
};

/** Everything the live route can render, one variant per screen. */
export type SpectateScreen =
  | {
      readonly kind: 'signed-out';
      readonly signInHref: string;
      readonly teaser: Teaser | null;
    }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'conflict'; readonly yourDebateHref: string }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'full' }
  | {
      readonly kind: 'upcoming';
      readonly title: string;
      readonly seats: readonly {
        readonly label: string;
        readonly handle: string;
        readonly rating: number;
        readonly ready: boolean;
      }[];
    }
  | { readonly kind: 'watch'; readonly view: SpectateView };

function teaserFor(debate: WatchDebate | null): Teaser | null {
  if (
    debate === null ||
    debate.visibility !== 'public' ||
    debate.state.status !== 'live'
  )
    return null;
  return {
    title: debate.title,
    modeLabel: debate.mode === 'ranked' ? 'Ranked' : 'Casual',
    watching: debate.state.watching,
  };
}

/**
 * The live route's one flow driver: the debate id and the viewer decide the
 * screen. Today it reads the sample debates; the backend read and the
 * realtime subscription replace `findDebate` and the view's connection.
 */
export function openSpectate(
  id: string,
  viewer: WatchViewer,
  query: SpectateQuery,
): SpectateScreen {
  const debate = findDebate(id);
  const decision = decideSpectate(debate, viewer);
  if (decision === 'signed-out')
    return {
      kind: 'signed-out',
      signInHref: signInToWatchHref(id),
      teaser: teaserFor(debate),
    };
  if (decision === 'unavailable' || debate === null)
    return { kind: 'unavailable' };
  if (decision === 'conflict')
    return { kind: 'conflict', yourDebateHref: watchRoutes.yourDebate };
  if (decision === 'revoked') return { kind: 'revoked' };
  if (decision === 'full') return { kind: 'full' };
  if (decision === 'upcoming' && debate.state.status === 'upcoming')
    return {
      kind: 'upcoming',
      title: debate.title,
      seats: [
        {
          label: 'Aff',
          handle: debate.aff.handle,
          rating: debate.aff.rating,
          ready: debate.state.affReady,
        },
        {
          label: 'Neg',
          handle: debate.neg.handle,
          rating: debate.neg.rating,
          ready: debate.state.negReady,
        },
      ],
    };
  const { phases, turns } = debateSchedule(debate);
  return {
    kind: 'watch',
    view: buildSpectateView({
      debate,
      query,
      phases,
      turns,
      social: spectatorSocial(debate),
      context: debateContext(debate),
    }),
  };
}
