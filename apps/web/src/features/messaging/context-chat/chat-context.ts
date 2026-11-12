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
  /** What the product calls this chat in a sentence. */
  readonly name: string;
};
