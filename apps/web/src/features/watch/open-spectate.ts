import { findRound, type WatchSource } from './round-source';
import type { WatchRound, WatchViewer } from './round';
import { decideSpectate } from './spectate';
import type { SpectateQuery } from './spectate-query';
import { buildSpectateView, type SpectateView } from './spectate-view';
import { watchRoutes } from './routes';

/** Everything the live route can render, one variant per screen. */
export type SpectateScreen =
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

/**
 * The live route's one flow driver: the Round id and the viewer decide the
 * screen.
 */
export function openSpectate(
  id: string,
  viewer: WatchViewer,
  query: SpectateQuery,
  source: WatchSource,
): SpectateScreen {
  const round = findRound(source, id);
  const decision = decideSpectate(round, viewer);
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
  const { phases, turns } = source.schedule(round);
  return {
    kind: 'watch',
    view: buildSpectateView({
      round,
      query,
      phases,
      turns,
      social: source.social(round),
      context: source.context(round),
    }),
  };
}
