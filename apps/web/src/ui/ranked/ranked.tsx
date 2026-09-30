import type { RankedScreen } from '../../features/ranked/drive-match';
import { MatchEnded } from './match-ended/match-ended';
import { MatchEntering } from './match-entering/match-entering';
import { MatchOffer } from './match-offer/match-offer';
import { MatchReady } from './match-ready/match-ready';
import { MatchSearch } from './match-search/match-search';
import { MatchWaiting } from './match-waiting/match-waiting';
import { RankedHub } from './ranked-hub/ranked-hub';

/** The Ranked page: the screen the flow driver chose for the URL step. */
export function Ranked({ screen }: { readonly screen: RankedScreen }) {
  switch (screen.step) {
    case 'hub':
      return <RankedHub screen={screen} />;
    case 'search':
      return <MatchSearch screen={screen} />;
    case 'offer':
      return <MatchOffer screen={screen} />;
    case 'waiting':
      return <MatchWaiting screen={screen} />;
    case 'ready':
      return <MatchReady screen={screen} />;
    case 'entering':
      return <MatchEntering screen={screen} />;
    case 'ended':
      return <MatchEnded screen={screen} />;
  }
}
