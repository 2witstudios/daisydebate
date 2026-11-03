/** Spectator reactions and chat, as a live Round's audience sees them. */

type Reaction = {
  readonly id: string;
  readonly label: string;
  /** Anonymous total; no names are kept or shown. */
  readonly count: number;
};

type ChatMessage = {
  readonly id: string;
  readonly handle: string;
  /** Clock time the message was posted, as shown. */
  readonly at: string;
  /** Null when a moderator removed the message. */
  readonly text: string | null;
};

export type SpectatorSocial = {
  readonly reactions: readonly Reaction[];
  readonly messages: readonly ChatMessage[];
};

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
