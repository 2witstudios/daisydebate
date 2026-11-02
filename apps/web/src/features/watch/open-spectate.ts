import {
  roundSchedule,
  roundContext,
  findRound,
  spectatorSocial,
} from './round-source';
import type { WatchRound, WatchViewer } from './round';
import { decideSpectate } from './spectate';
import type { SpectateQuery } from './spectate-query';
import { buildSpectateView, type SpectateView } from './spectate-view';
import { signInToWatchHref, watchRoutes } from './routes';

/** A Round's headline, shown to a signed-out visitor to invite them in. */
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
  | { readonly kind: 'conflict'; readonly yourRoundHref: string }
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

function teaserFor(round: WatchRound | null): Teaser | null {
  if (
    round === null ||
    round.visibility !== 'public' ||
    round.state.status !== 'live'
  )
    return null;
  return {
    title: round.title,
    modeLabel: round.mode === 'ranked' ? 'Ranked' : 'Casual',
    watching: round.state.watching,
  };
}

/**
 * The live route's one flow driver: the Round id and the viewer decide the
 * screen. Today it reads the sample Rounds; the backend read and the
 * realtime subscription replace `findDebate` and the view's connection.
 */
export function openSpectate(
  id: string,
  viewer: WatchViewer,
  query: SpectateQuery,
): SpectateScreen {
  const round = findRound(id);
  const decision = decideSpectate(round, viewer);
  if (decision === 'signed-out')
    return {
      kind: 'signed-out',
      signInHref: signInToWatchHref(id),
      teaser: teaserFor(round),
    };
  if (decision === 'unavailable' || round === null)
    return { kind: 'unavailable' };
  if (decision === 'conflict')
    return { kind: 'conflict', yourRoundHref: watchRoutes.yourRound };
  if (decision === 'revoked') return { kind: 'revoked' };
  if (decision === 'full') return { kind: 'full' };
  if (decision === 'upcoming' && round.state.status === 'upcoming')
    return {
      kind: 'upcoming',
      title: round.title,
      seats: [
        {
          label: 'Aff',
          handle: round.aff.handle,
          rating: round.aff.rating,
          ready: round.state.affReady,
        },
        {
          label: 'Neg',
          handle: round.neg.handle,
          rating: round.neg.rating,
          ready: round.state.negReady,
        },
      ],
    };
  const { phases, turns } = roundSchedule(round);
  return {
    kind: 'watch',
    view: buildSpectateView({
      round,
      query,
      phases,
      turns,
      social: spectatorSocial(round),
      context: roundContext(round),
    }),
  };
}
