import type { Clock } from '@daisy/clock';
import type { MessagingSocialBounds } from '@daisy/protocol';
/** Explicit edge inputs shared by issuance and membership operations. */
export type MessagingGroupOperationDependencies = {
  readonly bounds: MessagingSocialBounds;
  readonly clock: Clock;
  readonly limit: (actorId: string) => Promise<void>;
};
