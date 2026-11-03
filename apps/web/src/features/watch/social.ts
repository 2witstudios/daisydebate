/** Who a viewer follows, and what they watched, as the Following tab shows it. */

/** One person the viewer follows, and what they are doing. */
export type Followed = {
  readonly handle: string;
  /** The live Round they are in, or null with how long ago they last played. */
  readonly live: { readonly id: string; readonly title: string } | null;
  readonly lastRound: string | null;
};

/** One replay or live view the viewer watched. */
export type WatchedItem = {
  readonly id: string;
  readonly title: string;
  readonly note: string;
};

export type Following = {
  readonly people: readonly Followed[];
  readonly history: readonly WatchedItem[];
};
