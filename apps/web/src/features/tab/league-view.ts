type LadderScope = 'top' | 'around';

/** One tab of a league's lobby, with what its address chose on it. */
export type LeagueView =
  | { readonly tab: 'rooms' }
  | {
      readonly tab: 'ladder';
      readonly scope: LadderScope;
      readonly search: string;
    }
  | { readonly tab: 'season'; readonly event: string | null }
  | { readonly tab: 'tournaments' };

/** The view an address asks for; anything unknown reads as the Rooms tab. */
export function leagueViewOf(query: {
  readonly tab: string | null;
  readonly scope: string | null;
  readonly search: string | null;
  readonly event: string | null;
}): LeagueView {
  switch (query.tab) {
    case 'ladder':
      return {
        tab: 'ladder',
        scope: query.scope === 'around' ? 'around' : 'top',
        search: (query.search ?? '').trim().slice(0, 40),
      };
    case 'season':
      return { tab: 'season', event: query.event };
    case 'tournaments':
      return { tab: 'tournaments' };
    case 'rooms':
    case null:
    default:
      return { tab: 'rooms' };
  }
}
