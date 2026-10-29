import { rankedDestinations } from './actions';
import {
  bandLabel,
  hostBands,
  hostHref,
  seatSpan,
  seatSpanText,
  type HostBand,
  type HostQuery,
} from './host-query';
import { describeRating, type RankedStanding } from './standing';

type HostBandOption = {
  readonly value: HostBand;
  readonly label: string;
};

/** What the host screens render; `step` picks the form or the confirmation. */
export type HostScreen = {
  readonly step: HostQuery['step'];
  readonly band: HostBand;
  readonly bandOptions: readonly HostBandOption[];
  /** "Your rating: 1412 (provisional)" or "Unrated". */
  readonly ratingText: string;
  readonly seatText: string;
  /** Where the form's GET goes, then the cancel, lobby and close links. */
  readonly formAction: string;
  readonly cancelHref: string;
  readonly lobbyHref: string;
  readonly closeHref: string;
};

/** Pure: the host screen for a query and standing. */
export function hostScreenFor(
  { step, band }: HostQuery,
  { rating }: RankedStanding,
): HostScreen {
  const { kind, figure } = describeRating(rating);
  return {
    step,
    band,
    bandOptions: hostBands.map((value) => ({ value, label: bandLabel(value) })),
    ratingText: kind === 'unrated' ? figure : `${figure} (${kind})`,
    seatText: seatSpanText(seatSpan(rating, band)),
    formAction: rankedDestinations.hostTable,
    cancelHref: rankedDestinations.ranked,
    lobbyHref: rankedDestinations.lobby,
    closeHref: hostHref({ step: 'edit', band }),
  };
}
