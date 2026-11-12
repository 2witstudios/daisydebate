/** The words and element ids one context gives the shared thread. */
export type ContextChatLabels = {
  /** The accessible name of the whole chat region. */
  readonly region: string;
  readonly heading: string;
  /** Who reads this chat, under the heading. */
  readonly audience: string;
  /** The composer's accessible name and placeholder. */
  readonly composer: string;
  /** The accessible name of the message list. */
  readonly messages: string;
  /** Begins every element id the thread mints, so two chats never share one. */
  readonly idPrefix: string;
};
