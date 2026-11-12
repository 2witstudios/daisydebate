/** The words and element ids one context gives the shared thread. */
export type ContextChatLabels = {
  /** The accessible name of the whole chat region. */
  readonly region: string;
  readonly heading: string;
  /** Who reads this chat, under the heading. */
  readonly audience: string;
  /** The composer's accessible name and placeholder. */
  readonly composer: string;
  /**
   * For a reader who may read and not post: what they are told, and whether
   * the composer stays, locked, or is not shown. A chat that ended keeps a
   * draft in view; a reader who never posts has none to keep.
   */
  readonly readOnly: {
    readonly notice: string;
    readonly composer: 'locked' | 'none';
  };
  /** What stands for an author this reader is given no name for. */
  readonly unnamedAuthor: string;
  /** The accessible name of the message list. */
  readonly messages: string;
  /** Begins every element id the thread mints, so two chats never share one. */
  readonly idPrefix: string;
};
