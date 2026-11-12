import { createAppError } from '@daisy/errors';

type Caller = { readonly userId: string; readonly actorId: string };
type Action = 'read' | 'post' | 'remove';

/**
 * The one refusal every context chat gives. The store asks for one caller's
 * authority; it must be the caller this request was made by, and the
 * context's own pure decision must allow the action. A refused post answers
 * AUTHORIZATION: the caller has already read the chat, or is refused the read
 * before it. Anything else answers NOT_FOUND, so a chat is never confirmed to
 * someone who may not read it.
 */
export function contextChatFence<Fact, Account>(
  caller: Caller,
  allows: (input: {
    readonly fact: Fact;
    readonly account: Account;
    readonly action: Action;
  }) => boolean,
) {
  return async ({
    scope,
    fact,
    account,
    action,
  }: {
    readonly scope: Caller;
    readonly fact: Fact;
    readonly account: Account;
    readonly action: Action;
  }): Promise<void> => {
    const bound =
      scope.userId === caller.userId && scope.actorId === caller.actorId;
    if (!bound || !allows({ fact, account, action }))
      throw createAppError(action === 'post' ? 'AUTHORIZATION' : 'NOT_FOUND');
  };
}
