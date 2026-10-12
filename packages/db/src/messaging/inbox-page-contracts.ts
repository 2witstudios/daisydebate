import type { authorizationAccountFact } from '../authorization-account';
import type { authorizationAgeFacts } from '../authorization-age-batch';
import type { MessagingChannelFact } from './social';
import type { MessagingGroupInvitationFact } from './group-invitation-contracts';

export type MessagingInboxScope = {
  readonly userId: string;
  readonly actorId: string;
  readonly limit: number;
  readonly after?: string;
};
/** Minimal preview facts; contact pairs are attached from the page's fenced pair set. */
export type MessagingInboxInvitation = Omit<
  MessagingGroupInvitationFact,
  'contactPairs' | 'expectedGeneration'
>;
type Account = NonNullable<ReturnType<typeof authorizationAccountFact>>;
type SocialAccount = Awaited<ReturnType<typeof authorizationAgeFacts>>[number];
export type MessagingInboxPageFacts = {
  readonly principal: { readonly userId: string; readonly actorId: string };
  readonly account: Account | null;
  /** SHARE-fenced dependency accounts with current age facts, keyed by actor. */
  readonly accounts: ReadonlyMap<string, SocialAccount>;
  readonly contactPairs: MessagingGroupInvitationFact['contactPairs'];
  /** Database time read after every fence wait. */
  readonly now: string;
  readonly candidates: readonly {
    readonly channelId: string;
    readonly hidden: boolean;
    readonly channel: MessagingChannelFact | null;
    readonly invitation: MessagingInboxInvitation | null;
  }[];
};
/**
 * Pure policy. `collection` throws AUTHORIZATION to deny the inbox: it runs once on an
 * unfenced caller read before any association is scanned, and again on fenced facts.
 * `entries` returns the allowed entries for the fenced page.
 */
export type MessagingInboxDecision<T> = {
  readonly collection: (input: {
    readonly account: Account | null;
    readonly now: string;
  }) => void;
  readonly entries: (facts: MessagingInboxPageFacts) => readonly T[];
};
export type MessagingInboxPage<T> = {
  readonly entries: readonly T[];
  readonly nextAfter: string | null;
};
