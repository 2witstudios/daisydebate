import type { LiveCard } from './live-card';

/** One person a viewer follows, and the live Round they are in, if any. */
export type Followed = {
  readonly handle: string;
  readonly live: { readonly id: string; readonly title: string } | null;
};

/** One Round the viewer watched. */
export type WatchedItem = {
  readonly id: string;
  readonly title: string;
  /** The UTC day they last watched it. */
  readonly watchedOn: string;
};

/** What the Following tab shows: private to the one account it was read for. */
export type Following = {
  readonly people: readonly Followed[];
  readonly history: readonly WatchedItem[];
};

/** What the tab says of a Round whose resolution is not released yet. */
const UNRELEASED_TITLE = 'A Round on air';

/** The tab, from who this account follows, who is live, and what it watched. */
export const followingOf = (input: {
  readonly usernames: readonly string[];
  readonly live: ReadonlyMap<string, Pick<LiveCard, 'id' | 'title'>>;
  readonly history: readonly {
    readonly roundId: string;
    readonly resolution: string | null;
    readonly watchedAt: string;
  }[];
}): Following => ({
  people: input.usernames.map((handle) => {
    const round = input.live.get(handle);
    return {
      handle,
      live: round ? { id: round.id, title: round.title } : null,
    };
  }),
  history: input.history.map((entry) => ({
    id: entry.roundId,
    title: entry.resolution ?? UNRELEASED_TITLE,
    watchedOn: entry.watchedAt.slice(0, 10),
  })),
});
