import type { MessagingConversation } from '../../features/messaging/conversation';

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
    _previous: { readonly text: string; readonly requestId: string },
    form: FormData,
  ) => {
    if (Object.hasOwn(_previous, 'completion'))
      throw new Error('Client origin reached the server action');
    calls++;
    const requestId = String(form.get('requestId'));
    submissions.push({ requestId, text: String(form.get('text')) });
    const failure = scenario === 'refusal' || scenario === 'transport';
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
    if (scenario === 'refusal')
      return {
        text: String(form.get('text')),
        requestId,
        notice: 'Controlled refusal',
      };
    return {
      text: '',
      requestId,
      next: fresh
        ? '/messages/channel?sent=new'
        : successor
          ? '/messages/successor?sent=second'
          : '/messages/channel?sent=message',
    };
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
        editedAt: null,
      },
    ],
  };
  return history;
}
