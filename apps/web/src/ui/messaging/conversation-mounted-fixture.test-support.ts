import type { MessagingConversation } from '../../features/messaging/conversation';
import { moved } from '../../features/forms/form-state';
import {
  messageRefused,
  type MessageFormState,
} from '../../features/messaging/forms/send-form';

export function deferredConversationAction(scenario: string) {
  const started = Promise.withResolvers<void>();
  const freshStarted = Promise.withResolvers<void>();
  const freshAnswer = Promise.withResolvers<void>();
  const submissions: { requestId: string; text: string }[] = [];
  const successorStarted = Promise.withResolvers<void>();
  const successorAnswer = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let calls = 0;
  let commits = 0;
  const committedCommands = new Set<string>();
  const action = async (
    _previous: MessageFormState,
    form: FormData,
  ): Promise<MessageFormState> => {
    if (Object.hasOwn(_previous, 'completion'))
      throw new Error('Client origin reached the server action');
    calls++;
    const requestId = String(form.get('requestId'));
    submissions.push({ requestId, text: String(form.get('text')) });
    const refused = scenario === 'refusal' || scenario === 'superseded-refusal';
    const failure = refused || scenario === 'transport';
    if (!failure && !committedCommands.has(requestId)) {
      committedCommands.add(requestId);
      commits++;
    }
    const successor = form.get('requestId') === 'successor';
    const fresh = requestId === 'fresh';
    (fresh ? freshStarted : successor ? successorStarted : started).resolve();
    await (fresh ? freshAnswer : successor ? successorAnswer : answer).promise;
    if (
      scenario === 'transport' ||
      (scenario === 'unknown-commit' && calls === 1)
    )
      throw new Error('Controlled transport refusal');
    if (refused)
      return messageRefused(
        { text: String(form.get('text')), requestId },
        'Controlled refusal',
      );
    return moved(
      fresh
        ? '/messages/channel?sent=new'
        : successor
          ? '/messages/successor?sent=second'
          : '/messages/channel?sent=message',
    );
  };

  return {
    action,
    started,
    freshStarted,
    freshAnswer,
    successorStarted,
    successorAnswer,
    answer,
    submissions,
    calls: () => calls,
    commits: () => commits,
  };
}

export function recordingConversationRouter(commands: string[]) {
  const router = {
    bfcacheId: 'mounted-proof',
    back() {},
    forward() {},
    refresh() {},
    push(href: string) {
      commands.push(`intent:${href}`);
    },
    replace(href: string) {
      commands.push(`replace:${href}`);
    },
    prefetch() {},
  };
  return router;
}

export function mountedConversationHistory(): MessagingConversation {
  const history: MessagingConversation = {
    version: 1,
    channelId: 'channel',
    changeVersion: 1,
    nextBefore: { channelId: 'channel', sequence: 2 },
    messages: [
      {
        id: 'message',
        channelId: 'channel',
        authorActorId: 'actor',
        sequence: 1,
        changeVersion: 1,
        text: 'Committed message',
        createdAt: '2026-11-01T00:00:00.000Z',
        reactions: [],
        editedAt: null,
      },
    ],
  };
  return history;
}
