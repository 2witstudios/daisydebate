import type { Database } from '@daisy/db';
import { spectatorClockAt } from '../spectating/spectator-clock';
import { liveCardOf, type LiveCard } from './live-card';
import type { LiveQuery } from './live-query';

/** How many live Rounds one page of the listing holds. */
const LIVE_PAGE_SIZE = 24;

export type LiveStore = Pick<
  Database,
  'listLiveBroadcasts' | 'countLiveBroadcasts'
>;

export type LiveHubListing = {
  /** The newest ranked Round on the listing's first page. */
  readonly featured: LiveCard | null;
  readonly rows: readonly LiveCard[];
  /** Every listed live Round before filtering. */
  readonly total: number;
  /** The Round id the next page starts after; null on the last page. */
  readonly nextBefore: string | null;
};

/** One page of the Live listing, real rows under the one release rule. */
export async function listLive(
  store: LiveStore,
  input: { readonly query: LiveQuery; readonly now: string },
): Promise<LiveHubListing> {
  const clock = spectatorClockAt(input.now);
  const { query } = input;
  const [page, total] = await Promise.all([
    store.listLiveBroadcasts({
      filter: { mode: query.mode, q: query.q },
      before: query.before,
      clock,
      limit: LIVE_PAGE_SIZE,
    }),
    store.countLiveBroadcasts({ clock }),
  ]);
  const cards = page.rows.map(liveCardOf);
  const featured =
    query.before === '' ? (cards.find((card) => card.ranked) ?? null) : null;
  return {
    featured,
    rows: cards.filter((card) => card !== featured),
    total,
    nextBefore: page.nextBefore,
  };
}

/** How many Rounds the home page and a person's page lead with. */
const LEAD_SIZE = 3;

/** The newest live Rounds, for an entry point that leads to the listing. */
export const leadingLive = async (
  store: LiveStore,
  now: string,
): Promise<readonly LiveCard[]> => {
  const { rows } = await store.listLiveBroadcasts({
    filter: { mode: 'any', q: '' },
    before: '',
    clock: spectatorClockAt(now),
    limit: LEAD_SIZE,
  });
  return rows.map(liveCardOf);
};

/** Each named debater's live Round, for a profile or the Friends list. */
export const liveRoundsOf = async (
  store: LiveStore,
  input: { readonly usernames: readonly string[]; readonly now: string },
): Promise<ReadonlyMap<string, LiveCard>> => {
  if (input.usernames.length === 0) return new Map();
  const { rows } = await store.listLiveBroadcasts({
    filter: { mode: 'any', q: '' },
    before: '',
    clock: spectatorClockAt(input.now),
    limit: input.usernames.length,
    seatedUsernames: input.usernames,
  });
  return new Map(
    rows.flatMap((row) =>
      row.seats.flatMap((seat) =>
        seat.username && input.usernames.includes(seat.username)
          ? [[seat.username, liveCardOf(row)] as const]
          : [],
      ),
    ),
  );
};
