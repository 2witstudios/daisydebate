/** Isolated mounted caller fixture: Next's routing edge records commands only. */
import { mock } from 'bun:test';
import { Window } from 'happy-dom';
import type { MessagingConversation } from '../../features/messaging/conversation';
export const createMessagingNavigationRealm = () =>
  new Window({
    url: 'https://daisy.test/messages/channel',
    settings: {
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
      },
    },
  });
export async function runMessagingNavigationProbe(
  win: Window,
  scenario: string,
) {
  const document = win.document as unknown as Document;
  const commands: string[] = [];
  mock.module('./typing-browser', () => ({
    createBrowserTypingWriter: () => ({
      activity: async () => {},
      close: async () => {},
    }),
  }));
  mock.module('next/dist/client/components/navigator', () => ({
    navigate: (href: string) => commands.push(`intent:${href}`),
  }));
  // Prefetch I/O is outside this mounted command proof; real Next is covered in E2E.
  mock.module('next/dist/client/components/links', () => ({
    IDLE: { pending: false },
    mountLinkInstance: () => ({}),
    onNavigationIntent() {},
    unmountLinkForCurrentNavigation() {},
    unmountPrefetchableInstance() {},
  }));
  const { act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AppRouterContext } =
    await import('next/dist/shared/lib/app-router-context.shared-runtime');
  // Match Next's App Router alias instead of Bun's default Pages Router Link.
  const { default: AppLink } = await import('next/dist/client/app-dir/link');
  mock.module('next/link', () => ({ default: AppLink }));
  const { ConversationNavigation, ConversationLink, ConversationSearchForm } =
    await import('./conversation-navigation');
  const { MessageComposer } = await import('./message-composer');
  const { MessageHistory } = await import('./message-history');
  const started = Promise.withResolvers<void>();
  const successorStarted = Promise.withResolvers<void>();
  const successorAnswer = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let calls = 0;
  let commits = 0;
  const action = async (
    _previous: { readonly text: string; readonly requestId: string },
    form: FormData,
  ) => {
    calls++;
    commits++;
    const successor = form.get('requestId') === 'successor';
    (successor ? successorStarted : started).resolve();
    await (successor ? successorAnswer : answer).promise;
    return {
      text: '',
      requestId: 'request',
      next: successor
        ? '/messages/successor?sent=second'
        : '/messages/channel?sent=message',
    };
  };
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
  const history: MessagingConversation = {
    version: 1,
    channelId: 'channel',
    changeVersion: 1,
    nextBefore: null,
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
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function tree(key = 'channel', route = router) {
    return (
      <StrictMode>
        <AppRouterContext.Provider value={route}>
          <ConversationNavigation key={key}>
            <MessageHistory history={history} actorId="actor" />
            <ConversationLink
              href="/messages/channel/preferences"
              target={scenario === 'new-tab' ? '_blank' : undefined}
              {...(scenario === 'canceled'
                ? {
                    onClick: (
                      event: import('react').MouseEvent<HTMLAnchorElement>,
                    ) => event.preventDefault(),
                  }
                : {})}
            >
              Preferences
            </ConversationLink>
            <ConversationSearchForm
              action="/messages/channel"
              method="get"
              onSubmitCapture={
                scenario === 'canceled-search'
                  ? (event) => event.preventDefault()
                  : undefined
              }
            >
              <input
                name="query"
                required
                defaultValue={scenario === 'invalid-search' ? '' : 'query'}
              />
              <button>Search</button>
            </ConversationSearchForm>
            <MessageComposer
              action={action}
              requestId={key === 'successor' ? 'successor' : 'request'}
              channelId={key}
              maxUnits={200}
            />
          </ConversationNavigation>
        </AppRouterContext.Provider>
      </StrictMode>
    );
  }
  await act(async () => root.render(tree()));
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
  field.value = 'Draft';
  await act(async () => {
    field.form!.dispatchEvent(
      new win.Event('submit', {
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    );
    await started.promise;
  });
  const pending = field.disabled && host.textContent!.includes('Sending…');
  if (['edit', 'modified'].includes(scenario!)) {
    const edit = [...host.querySelectorAll('a')].find(
      (link) => link.textContent === 'Edit or remove your message',
    )!;
    await act(async () => {
      edit.dispatchEvent(
        new win.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: scenario === 'modified',
        }) as unknown as MouseEvent,
      );
    });
  }
  if (['new-tab', 'canceled', 'preferences'].includes(scenario!)) {
    const link = [...host.querySelectorAll('a')].find(
      (link) => link.textContent === 'Preferences',
    )!;
    await act(async () => {
      link.dispatchEvent(
        new win.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }) as unknown as MouseEvent,
      );
    });
  }
  if (
    [
      'search',
      'canceled-search',
      'invalid-search',
      'late-canceled-search',
    ].includes(scenario)
  ) {
    if (scenario === 'late-canceled-search')
      document.addEventListener('submit', (event) => event.preventDefault(), {
        once: true,
      });
    await act(async () => {
      host.querySelector('form')!.requestSubmit();
    });
  }
  if (scenario === 'disposed') await act(async () => root.unmount());
  if (scenario === 'replaced' || scenario === 'replaced-active')
    await act(async () => root.render(tree('successor')));
  if (scenario === 'replaced-active') {
    const successorField = host.querySelector<HTMLTextAreaElement>('textarea')!;
    successorField.value = 'Second draft';
    await act(async () => {
      successorField.form!.dispatchEvent(
        new win.Event('submit', {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
      await successorStarted.promise;
    });
  }
  await act(async () => {
    answer.resolve();
    await answer.promise;
  });
  const commandsBeforeSuccessor = [...commands];
  if (scenario === 'replaced-active') {
    await act(async () => {
      successorAnswer.resolve();
      await successorAnswer.promise;
    });
  }
  if (scenario !== 'disposed') {
    // A changed router identity re-observes the same settled answer.
    await act(async () =>
      root.render(
        tree(scenario.startsWith('replaced') ? 'successor' : 'channel', {
          ...router,
        }),
      ),
    );
    await act(async () => root.unmount());
  }
  return {
    pending,
    calls,
    commits,
    commands,
    ...(scenario === 'replaced-active' ? { commandsBeforeSuccessor } : {}),
  };
}
