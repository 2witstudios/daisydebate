/** Isolated DOM edge: prove the latest page without a socket uses authorized action counts. */
import { mock } from 'bun:test';
import { Window } from 'happy-dom';
const win = new Window({ url: 'https://daisy.test/messages/channel' });
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Event',
  'FormData',
] as const) {
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? win : win[key],
    configurable: true,
  });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});
mock.module('next/link', () => ({
  default: ({ children }: { children: import('react').ReactNode }) => (
    <span>{children}</span>
  ),
}));
mock.module('../src/ui/messaging/mark-read', () => ({
  MarkConversationRead: () => null,
}));
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ConversationLive } =
  await import('../src/ui/messaging/conversation-live');
const { mountedConversationHistory } =
  await import('../src/ui/messaging/conversation-mounted-fixture.test-support');
const channelId = 'c'.repeat(24);
const initial = mountedConversationHistory();
const history = {
  ...initial,
  channelId,
  nextBefore: null,
  messages: initial.messages.map((message) => ({
    ...message,
    channelId,
    reactions: [{ reaction: '👍', count: 1 }],
  })),
};
const host = win.document.createElement('div');
win.document.body.append(host);
const root = createRoot(host as unknown as HTMLElement);
let calls = 0;
try {
  await act(async () =>
    root.render(
      <ConversationLive
        channelId={channelId}
        history={history}
        actorId="reader"
        otherAuthor="Member"
        socketUrl={null}
        typingRefetchMs={null}
        now="2026-11-04T00:00:00.000Z"
        viewer={{
          readSequence: 1,
          firstUnreadSequence: null,
          ownReactions: [],
        }}
        typingName="Member"
        filesAvailable={false}
        reactAction={async (_previous, form) => {
          calls++;
          const own = form.get('active') === 'true';
          return { own, count: own ? 2 : 1 };
        }}
      />,
    ),
  );
  const labels: (string | null | undefined)[] = [];
  for (let index = 0; index < 2; index++) {
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(
          new win.Event('submit', { bubbles: true, cancelable: true }),
        );
    });
    labels.push(host.querySelector('button')?.getAttribute('aria-label'));
  }
  process.stdout.write(JSON.stringify({ calls, labels }));
} finally {
  await act(async () => root.unmount());
  await win.happyDOM.close();
}
