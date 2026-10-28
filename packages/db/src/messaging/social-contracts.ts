import type { SocialRequestLimits } from '../contacts/request-budget';
import type { ContactFact, ContactInput } from '../contacts/fence';

export type MessagingSocialFrame = {
  readonly readDmRequest: () => Promise<{
    readonly channelId: string;
    readonly state: string;
  } | null>;
  /**
   * Call after `screenDmRequest` answered null: an existing pending or
   * accepted DM refuses CONFLICT here instead of converging.
   */
  readonly commitDmRequest: (input: {
    readonly requestId: string;
    readonly channelId: string;
    readonly introduction: string | null;
    readonly digest: string;
    readonly policyRevision: number;
    readonly now: string;
    readonly limits: SocialRequestLimits;
  }) => Promise<{ readonly channelId: string; readonly state: string }>;
  /**
   * Before any budget is spent: answers the existing pending or accepted DM
   * a request converges on, or else refuses (AUTHORIZATION, as a block) a
   * new request the commit would refuse, one the other member's declines
   * block at `now` (DEC-251) or one on an inactive channel, or answers null
   * for a new request to commit.
   */
  readonly screenDmRequest: (now: string) => Promise<{
    readonly channelId: string;
    readonly state: string;
  } | null>;
  readonly contacts: readonly ContactFact[];
  readonly readReceipt: (requestId: string) => Promise<{
    readonly kind: string;
    readonly digest: string | null;
    readonly channelId: string | null;
  } | null>;
};
export type MessagingSocialStore = {
  readonly withContacts: <T>(
    input: ContactInput,
    work: (frame: MessagingSocialFrame) => Promise<T>,
  ) => Promise<T>;
};
