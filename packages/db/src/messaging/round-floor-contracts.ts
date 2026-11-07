import type { ContentReportCreate } from '@daisy/protocol/content-moderation';
import type { RoundFloorFact } from '@daisy/protocol/round-floor';
import type { AuthorizationTransaction } from '../authorization';
import type { authorizationAccountFact } from '../authorization-account';
import type { MessagingLockedFrame, MessagingReadFrame } from './records';
export type RoundFloorScope = {
  readonly roundId: string;
  readonly channelId: string;
  readonly userId: string;
  readonly actorId: string;
};
export type RoundFloorAuthority = {
  readonly tx: AuthorizationTransaction;
  readonly scope: Omit<RoundFloorScope, 'channelId'>;
  readonly fact: RoundFloorFact;
  readonly account: ReturnType<typeof authorizationAccountFact>;
  readonly action: 'read' | 'post' | 'remove';
};
export type RoundFloorFence = (input: RoundFloorAuthority) => Promise<void>;
export type RoundFloorReadFrame = {
  readonly fileReport: (input: {
    readonly id: string;
    readonly messageId: string;
    readonly reason: Extract<
      ContentReportCreate,
      { targetKind: 'chat_message' }
    >['reason'];
  }) => Promise<void>;
  readonly readAuthors: () => Promise<
    readonly { readonly actorId: string; readonly label: string }[]
  >;
} & Omit<MessagingReadFrame, 'fact' | 'accounts'> &
  Pick<RoundFloorAuthority, 'fact' | 'account'>;
export type RoundFloorWriteFrame = Omit<
  MessagingLockedFrame,
  'fact' | 'accounts'
> &
  Pick<RoundFloorAuthority, 'fact' | 'account'>;
