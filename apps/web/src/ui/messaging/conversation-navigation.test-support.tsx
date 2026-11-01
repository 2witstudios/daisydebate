/** Isolated mounted caller fixture: Next's routing edge records commands only. */
import { mock } from 'bun:test';
import { Window } from 'happy-dom';
import {
  deferredConversationAction,
  recordingConversationRouter,
  mountedConversationHistory,
} from './conversation-mounted-fixture.test-support';
import {
  initiateConversationNavigation,
  readMountedComposer,
} from './conversation-navigation-controls.test-support';
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
  const { flushSync } = await import('react-dom');
  const { AppRouterContext } =
    await import('next/dist/shared/lib/app-router-context.shared-runtime');
  // Match Next's App Router alias instead of Bun's default Pages Router Link.
  const { default: AppLink } = await import('next/dist/client/app-dir/link');
  mock.module('next/link', () => ({ default: AppLink }));
  const { ConversationNavigation, ConversationLink, ConversationSearchForm } =
    await import('./conversation-navigation');
  const { MessageComposer } = await import('./message-composer');
  const { MessageHistory } = await import('./message-history');
  const activity = deferredConversationAction(scenario);
  const {
    action,
    started,
    freshStarted,
    freshAnswer,
    successorStarted,
    successorAnswer,
    answer,
    submissions,
  } = activity;
  const router = recordingConversationRouter(commands);
  const history = mountedConversationHistory();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function tree(
    key = 'channel',
    route = router,
    requestId = key === 'successor' ? 'successor' : 'request',
  ) {
    return (
      <StrictMode>
        <AppRouterContext.Provider value={route}>
          <ConversationNavigation key={key} requestId={requestId}>
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
            <MessageComposer action={action} channelId={key} maxUnits={200} />
          </ConversationNavigation>
        </AppRouterContext.Provider>
      </StrictMode>
    );
  }
  await act(async () => root.render(tree()));
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
  field.value = 'Draft';
  if (scenario === 'refreshed-draft')
    await act(async () => root.render(tree('channel', router, 'fresh')));
  const beforeDispatch =
    scenario === 'refreshed-draft'
      ? {
          text: field.value,
          requestId: host.querySelector<HTMLInputElement>(
            'input[name="requestId"]',
          )!.value,
        }
      : undefined;
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
  if (scenario === 'search-disposed' || scenario === 'search-replaced') {
    await act(async () => {
      host.querySelector('form')!.requestSubmit();
      // Dispose/replace before the native submit's cancellation checkpoint runs.
      if (scenario === 'search-disposed') root.unmount();
      else flushSync(() => root.render(tree('successor')));
    });
  }
  await initiateConversationNavigation(win, host, scenario, act);
  if (['refusal', 'transport', 'unknown-commit'].includes(scenario))
    await act(async () => root.render(tree('channel', router, 'fresh')));
  if (scenario.startsWith('same-conversation')) {
    if (scenario === 'same-conversation')
      await act(async () => root.render(tree('channel', router, 'fresh')));
    if (
      host.querySelector<HTMLInputElement>('input[name="requestId"]')!.value !==
      'request'
    )
      throw new Error('Pending command identity was replaced');
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
  if (scenario === 'same-conversation-late')
    await act(async () => root.render(tree('channel', router, 'fresh')));
  const nextCommand = scenario.startsWith('same-conversation')
    ? readMountedComposer(host)
    : undefined;
  let retainedNew;
  if (scenario.startsWith('same-conversation')) {
    host.querySelector<HTMLTextAreaElement>('textarea')!.value = 'NEW';
    await act(async () =>
      root.render(tree('channel', { ...router }, 'request')),
    );
    await act(async () => root.render(tree('channel', { ...router }, 'fresh')));
    retainedNew = readMountedComposer(host);
    await act(async () => {
      host.querySelector<HTMLTextAreaElement>('textarea')!.form!.dispatchEvent(
        new win.Event('submit', {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
      await freshStarted.promise;
    });
    await act(async () => {
      freshAnswer.resolve();
      await freshAnswer.promise;
    });
  }
  const failedDraft = ['refusal', 'transport', 'unknown-commit'].includes(
    scenario,
  )
    ? readMountedComposer(host)
    : undefined;
  if (scenario === 'unknown-commit') {
    await act(async () => {
      host.querySelector<HTMLTextAreaElement>('textarea')!.form!.dispatchEvent(
        new win.Event('submit', {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      );
    });
  }
  const commandsBeforeSuccessor = [...commands];
  if (scenario === 'replaced-active') {
    await act(async () => {
      successorAnswer.resolve();
      await successorAnswer.promise;
    });
  }
  if (scenario !== 'disposed' && scenario !== 'search-disposed') {
    // A changed router identity re-observes the same settled answer.
    await act(async () =>
      root.render(
        tree(
          scenario.includes('replaced') ? 'successor' : 'channel',
          { ...router },
          scenario.startsWith('same-conversation') ||
            scenario === 'refreshed-draft'
            ? 'fresh'
            : scenario.includes('replaced')
              ? 'successor'
              : 'request',
        ),
      ),
    );
    await act(async () => root.unmount());
  }
  return {
    pending,
    calls: activity.calls(),
    commits: activity.commits(),
    commands,
    ...(nextCommand ? { nextCommand, retainedNew, submissions } : {}),
    ...(failedDraft
      ? {
          failedDraft,
          ...(scenario === 'unknown-commit' ? { submissions } : {}),
        }
      : {}),
    ...(beforeDispatch ? { beforeDispatch } : {}),
    ...(scenario === 'replaced-active' ? { commandsBeforeSuccessor } : {}),
  };
}
