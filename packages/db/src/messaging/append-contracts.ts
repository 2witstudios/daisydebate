import { isAppError } from '@daisy/errors';
import type {
  MessagingAuthorizationFence,
  MessagingCreateSendPlan,
  MessagingMessageRecord,
  MessagingSendCommand,
  MessagingSendState,
  MessagingMutationCommand,
  MessagingMutationState,
  MessagingMutationPlan,
} from './records';
type Attempt = {
  readonly scope: {
    readonly actorId: string;
    readonly userId: string;
    readonly channelId: string;
  };
  readonly authorize: MessagingAuthorizationFence;
  readonly admit: () => Promise<void>;
};
export type MessagingSendAttempt = Attempt & {
  readonly command: MessagingSendCommand;
  readonly decide: (
    state: MessagingSendState,
  ) =>
    | MessagingCreateSendPlan
    | { readonly kind: 'replay'; readonly message: MessagingMessageRecord };
};
export type MessagingMutationAttempt = Attempt & {
  readonly command: MessagingMutationCommand;
  readonly decide: (
    state: MessagingMutationState,
  ) =>
    | (MessagingMutationPlan & { readonly kind: 'change' })
    | { readonly kind: 'replay'; readonly message: MessagingMessageRecord };
};
export type ContentAttempt = MessagingSendAttempt | MessagingMutationAttempt;
export const isMutation = (
  attempt: ContentAttempt,
): attempt is MessagingMutationAttempt => 'kind' in attempt.command;
export const expectedAppendError = (error: unknown) =>
  isAppError(error) &&
  [
    'AUTHORIZATION',
    'NOT_FOUND',
    'CONFLICT',
    'VALIDATION',
    'RATE_LIMIT',
  ].includes(error.code);
