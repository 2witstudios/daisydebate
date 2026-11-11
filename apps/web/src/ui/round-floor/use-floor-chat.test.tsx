import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { floorIdle } from '../../features/messaging/round-floor/form-state';
import type * as Client from './use-floor-chat.test-support';

setupRitewayBun();

const roundId = 'r'.repeat(24);
const channelId = 'c'.repeat(24);
const metadata = (readOnly = false) => ({
  version: 1,
  roundId,
  channelId,
  readOnly,
  expiresAt: null,
});
const page = (readOnly = false, changeVersion = 0) =>
  new Response(
    JSON.stringify({
      version: 1,
      roundId,
      metadata: metadata(readOnly),
      history: {
        version: 1,
        channelId,
        changeVersion,
        messages: [],
        nextBefore: null,
        viewer: {
          readSequence: 0,
          firstUnreadSequence: null,
          ownReactions: [],
        },
      },
      authors: [],
    }),
    {
      headers: {
        'x-messaging-message-units': '4000',
        'x-messaging-page-items': '100',
      },
    },
  );
const refuse = async () => floorIdle('q'.repeat(24));

const socketUrl = 'wss://realtime.test/ws';
type Frame = Readonly<Record<string, unknown>>;
type Heard = (event: { readonly type: string; readonly data?: string }) => void;

/** The realtime socket as the page sees it: the test is the server. */
const liveChannel = () => {
  const heard = new Map<string, Heard[]>();
  let asked: unknown = null;
  const say = (frame: Frame) => {
    const event = { type: 'message', data: JSON.stringify({ v: 1, ...frame }) };
    for (const listener of heard.get('message') ?? []) listener(event);
  };
  const resource = { kind: 'channel-messages', id: channelId };
  let generation = 0;
  return {
    WebSocket: class {
      readyState = 1;
      constructor() {
        queueMicrotask(() => {
          for (const listener of heard.get('open') ?? [])
            listener({ type: 'open' });
        });
      }
      addEventListener(type: string, listener: Heard) {
        heard.set(type, [...(heard.get(type) ?? []), listener]);
      }
      send(data: string) {
        const frame = JSON.parse(data) as Frame;
        if (frame.type === 'observe') asked = frame.id;
        if (frame.type === 'hello')
          queueMicrotask(() => say({ type: 'ready' }));
      }
      close() {}
    },
    /** Permits the page's latest ask to observe the floor's messages. */
    permit: () =>
      say({
        type: 'observation.ready',
        id: asked,
        resource,
        generation: (generation += 1),
        partition: 'member',
        disclosureRevision: 0,
        minimumContentRevision: 0,
        validForMs: 4000,
      }),
    revoke: () =>
      say({
        type: 'observation.state',
        resource,
        generation: (generation += 1),
        state: 'revoked',
      }),
  };
};

/** The hook in a private realm; the test answers each history read in its own time. */
const mount = async (
  live: ReturnType<typeof liveChannel> | null = null,
  firstPage: 'read' | 'on its way' = 'read',
) => {
  const reads: (ReturnType<typeof Promise.withResolvers<Response>> & {
    readonly url: string;
  })[] = [];
  let held: Parameters<Parameters<typeof client.FloorProbe>[0]['hold']>[0];
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./use-floor-chat.test-support', import.meta.dir),
    {
      ...(live
        ? { WebSocket: live.WebSocket, performance, crypto, AbortController }
        : {}),
      fetch: (url: string) => {
        if (url === '/api/realtime/ticket')
          return Promise.resolve(
            Response.json({ ticket: 't'.repeat(43), socketUrl }),
          );
        if (!url.includes('/messages'))
          return Promise.resolve(
            Response.json({ version: 1, roundId, channel: metadata() }),
          );
        const read = { ...Promise.withResolvers<Response>(), url };
        reads.push(read);
        return read.promise;
      },
      Response,
      Headers,
      URL,
      TextEncoder,
      TextDecoder,
    },
  );
  const act = (work: () => unknown) =>
    client.act(async () => {
      work();
      // The hook defers its own starts to a timer, and each read parses a body.
      for (let turn = 0; turn < 5; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await act(() =>
    client.root.render(
      client.createElement(client.FloorProbe, {
        roundId,
        actorId: 'a'.repeat(24),
        socketUrl: live ? socketUrl : null,
        requestId: 'q'.repeat(24),
        readOnlyHint: false,
        sendAction: refuse,
        mutateAction: refuse,
        reportAction: refuse,
        hold: (now) => {
          held = now;
        },
      }),
    ),
  );
  // The hook enters from an effect, which runs as the render's act closes.
  await act(() => undefined);
  if (firstPage === 'read') await act(() => reads[0]!.resolve(page()));
  return {
    reads,
    act,
    held: () => held,
    shown: () =>
      JSON.parse(client.container.querySelector('output')!.textContent!) as {
        state: string;
        readOnly: boolean | null;
        paging: boolean;
        notice: string | null;
      },
    unmount: () => client.act(async () => client.root.unmount()),
  };
};

test('an older page stays loading until its own read answers', async () => {
  const floor = await mount();
  try {
    await floor.act(() => floor.held().loadOlder(5));
    const older = floor.reads.at(-1)!;
    // A refresh starts and answers while the older page is still on its way.
    await floor.act(() => floor.held().refresh());
    await floor.act(() => floor.reads.at(-1)!.resolve(page()));
    const duringRefresh = floor.shown().paging;
    await floor.act(() => older.resolve(page()));
    assert({
      given:
        'an older page requested, then a refresh that answers before it does',
      should:
        'keep Older messages busy until the older page itself answers, so it is not asked twice',
      actual: {
        asked: older.url.includes('before=5'),
        duringRefresh,
        after: floor.shown().paging,
      },
      expected: { asked: true, duringRefresh: true, after: false },
    });
  } finally {
    await floor.unmount();
  }
});

test('a slower earlier read never replaces what a later read said', async () => {
  const floor = await mount();
  try {
    await floor.act(() => floor.held().refresh());
    const slow = floor.reads.at(-1)!;
    await floor.act(() => floor.held().refresh());
    // The later read says the floor has closed to writing.
    await floor.act(() => floor.reads.at(-1)!.resolve(page(true, 1)));
    const closed = floor.shown().readOnly;
    await floor.act(() => slow.resolve(page(false, 0)));
    assert({
      given:
        'two reads of the floor, the first answering after the second with the floor still open',
      should: 'keep the later answer: the floor stays read-only',
      actual: { closed, after: floor.shown().readOnly },
      expected: { closed: true, after: true },
    });
  } finally {
    await floor.unmount();
  }
});

test('an older page never says what the floor is now', async () => {
  const floor = await mount();
  try {
    await floor.act(() => floor.held().loadOlder(5));
    const older = floor.reads.at(-1)!;
    await floor.act(() => floor.held().refresh());
    // The refresh says the floor has closed to writing; the older page was
    // read before that and answers after it.
    await floor.act(() => floor.reads.at(-1)!.resolve(page(true, 1)));
    await floor.act(() => older.resolve(page(false, 0)));
    assert({
      given:
        'an older page read while the floor was open, answering after a refresh that found it closed',
      should: 'add its messages and leave the floor read-only',
      actual: { ...floor.shown() },
      expected: { state: 'ready', readOnly: true, paging: false, notice: null },
    });
  } finally {
    await floor.unmount();
  }
});

test('a read is applied when it answers, though a later one is already on its way', async () => {
  const floor = await mount();
  try {
    await floor.act(() => floor.held().refresh());
    const first = floor.reads.at(-1)!;
    // Traffic keeps asking: the next read starts before the first answers.
    await floor.act(() => floor.held().refresh());
    await floor.act(() => first.resolve(page(true, 1)));
    assert({
      given:
        'a read answering while a later read of the same kind is in flight',
      should: 'apply it, so steady traffic cannot leave every answer dropped',
      actual: floor.shown().readOnly,
      expected: true,
    });
  } finally {
    await floor.unmount();
  }
});

test('a later read that fails does not cost an earlier one its answer', async () => {
  const floor = await mount();
  try {
    await floor.act(() => floor.held().refresh());
    const first = floor.reads.at(-1)!;
    await floor.act(() => floor.held().refresh());
    await floor.act(() => floor.reads.at(-1)!.reject(new Error('offline')));
    const failed = floor.shown().notice;
    await floor.act(() => first.resolve(page(true, 1)));
    assert({
      given:
        'a read still on its way when a later read fails, then answering well',
      should:
        'say the later read failed, then apply the page and take that back',
      actual: { failed: failed !== null, after: floor.shown() },
      expected: {
        failed: true,
        after: { state: 'ready', readOnly: true, paging: false, notice: null },
      },
    });
  } finally {
    await floor.unmount();
  }
});

test('a read asked before the floor was denied never reopens it', async () => {
  const floor = await mount();
  try {
    await floor.act(() => floor.held().refresh());
    const earlier = floor.reads.at(-1)!;
    await floor.act(() => floor.held().refresh());
    await floor.act(() =>
      floor.reads.at(-1)!.resolve(new Response(null, { status: 403 })),
    );
    const denied = floor.shown().state;
    await floor.act(() => earlier.resolve(page()));
    assert({
      given:
        'a read still on its way when a later read is refused access, then answering well',
      should: 'leave the floor denied',
      actual: { denied, after: floor.shown().state },
      expected: { denied: 'denied', after: 'denied' },
    });
  } finally {
    await floor.unmount();
  }
});

test('a denied floor holds nothing of the thread it lost', async () => {
  const floor = await mount();
  try {
    await floor.act(() => floor.held().loadOlder(5));
    await floor.act(() => floor.held().refresh());
    await floor.act(() =>
      floor.reads.at(-1)!.resolve(new Response(null, { status: 403 })),
    );
    assert({
      given: 'an older page on its way when a refresh is refused access',
      should: 'be denied alone: no page loading, and no notice beside it',
      actual: floor.shown(),
      expected: {
        state: 'denied',
        readOnly: null,
        paging: false,
        notice: null,
      },
    });
  } finally {
    await floor.unmount();
  }
});

test('a floor hidden before its first page reads it when the reader may see it again', async () => {
  const live = liveChannel();
  const floor = await mount(live, 'on its way');
  const sight = () => ({
    reads: floor.reads.length,
    hidden: floor.held().hidden,
    pending: floor.held().pending,
    history: floor.held().history?.changeVersion ?? null,
  });
  try {
    const entering = sight();
    await floor.act(() => live.revoke());
    // The page asked for before the floor was hidden answers into nothing.
    await floor.act(() => floor.reads[0]!.resolve(page(false, 3)));
    const hidden = sight();
    await floor.act(() => live.permit());
    const shownAgain = sight();
    await floor.act(() => floor.reads.at(-1)!.resolve(page(false, 4)));
    assert({
      given:
        'a floor whose live channel hides it while the first page is on its way, then shows it again',
      should:
        'say it is loading only while a read is on its way: ask once more when shown, and show what that read brings',
      actual: { entering, hidden, shownAgain, read: sight() },
      expected: {
        entering: { reads: 1, hidden: false, pending: true, history: null },
        hidden: { reads: 1, hidden: true, pending: false, history: null },
        shownAgain: { reads: 2, hidden: false, pending: true, history: null },
        read: { reads: 2, hidden: false, pending: false, history: 4 },
      },
    });
  } finally {
    await floor.unmount();
  }
});

test('a floor hidden with its thread shown reads it afresh when shown again', async () => {
  const live = liveChannel();
  const floor = await mount(live);
  const sight = () => ({
    reads: floor.reads.length,
    hidden: floor.held().hidden,
    pending: floor.held().pending,
    history: floor.held().history?.changeVersion ?? null,
  });
  try {
    await floor.act(() => live.permit());
    const shown = sight();
    await floor.act(() => live.revoke());
    const hidden = sight();
    await floor.act(() => live.permit());
    const shownAgain = sight();
    await floor.act(() => floor.reads.at(-1)!.resolve(page(false, 2)));
    assert({
      given:
        'a floor with its thread shown, hidden by the live channel and then shown again',
      should:
        'withdraw the thread while hidden, ask for it once when shown, and show what that read brings',
      actual: { shown, hidden, shownAgain, read: sight() },
      expected: {
        shown: { reads: 1, hidden: false, pending: false, history: 0 },
        hidden: { reads: 1, hidden: true, pending: false, history: null },
        shownAgain: { reads: 2, hidden: false, pending: true, history: null },
        read: { reads: 2, hidden: false, pending: false, history: 2 },
      },
    });
  } finally {
    await floor.unmount();
  }
});
