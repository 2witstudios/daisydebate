/**
 * What tells one context chat from another on the wire and in words. A context
 * chat is a Messaging channel bound to one owning resource (a Round's floor, a
 * Room's chat); each context supplies its authority on the server and only
 * this to the shared thread.
 */
export type ChatContext = {
  /** The field naming the owner in this context's wire bodies. */
  readonly ownerKey: string;
  /** The context's HTTP address for one owner, with no trailing slash. */
  readonly address: (ownerId: string) => string;
  /**
   * Whether a reader who may not open this chat may still see someone else
   * open it, and so keeps asking while it is empty. True where some readers
   * only read (a Room's judge); false where nobody can open it once it is
   * read-only (a Round that is over).
   */
  readonly awaitsOpening: boolean;
  /** What the product calls this chat in a sentence. */
  readonly name: string;
};
