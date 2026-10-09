import type { AuthorizationTransaction } from '../authorization';
import type { authorizationAccountFact } from '../authorization-account';

type MessagingContactFact = {
  readonly lowActorId: string;
  readonly highActorId: string;
  readonly blocked: boolean;
  readonly revision: number;
};
export type MessagingSocialInput = {
  readonly actorId: string;
  readonly userId: string;
  readonly memberActorIds: readonly string[];
  readonly policyRevision?: number;
};
export type MessagingSocialAuthorizationFence = (
  tx: AuthorizationTransaction,
  input: MessagingSocialInput,
  facts: {
    readonly contacts: readonly MessagingContactFact[];
    readonly accounts: readonly ReturnType<typeof authorizationAccountFact>[];
  },
) => Promise<void>;
export type MessagingSocialFrame = {
  readonly readDmRequest: () => Promise<{
    readonly channelId: string;
    readonly state: string;
  } | null>;
  readonly commitDmRequest: (input: {
    readonly requestId: string;
    readonly channelId: string;
    readonly introduction: string | null;
    readonly digest: string;
    readonly policyRevision: number;
    readonly now: string;
    readonly limits: {
      readonly windowMs: number;
      readonly maxNewPairs: number;
      readonly maxPending: number;
      readonly cooldownMs: number;
    };
  }) => Promise<{ readonly channelId: string; readonly state: string }>;
  readonly blocking: boolean | null;
  readonly contacts: readonly MessagingContactFact[];
  readonly readReceipt: (requestId: string) => Promise<{
    readonly kind: string;
    readonly digest: string | null;
    readonly channelId: string | null;
  } | null>;
  readonly commitBlock: (input: {
    readonly requestId: string;
    readonly blocked: boolean;
    readonly digest: string;
    readonly now: string;
  }) => Promise<{ readonly blocked: boolean; readonly revision: number }>;
};
export type MessagingSocialStore = {
  readonly withContacts: <T>(
    input: MessagingSocialInput,
    work: (frame: MessagingSocialFrame) => Promise<T>,
  ) => Promise<T>;
};
