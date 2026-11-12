import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { contextChatIdle } from '../../features/messaging/context-chat/form-state';
import type * as Client from './use-context-chat.test-support';

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
const refuse = async () => contextChatIdle('q'.repeat(24));

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
    /** Permits the page's latest ask to observe the chat's messages. */
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
  let held: Parameters<
    Parameters<typeof client.ContextChatProbe>[0]['hold']
  >[0];
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./use-context-chat.test-support', import.meta.dir),
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
      client.createElement(client.ContextChatProbe, {
        ownerId: roundId,
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
  const chat = await mount();
  try {
    await chat.act(() => chat.held().loadOlder(5));
    const older = chat.reads.at(-1)!;
    // A refresh starts and answers while the older page is still on its way.
    await chat.act(() => chat.held().refresh());
    await chat.act(() => chat.reads.at(-1)!.resolve(page()));
    const duringRefresh = chat.shown().paging;
    await chat.act(() => older.resolve(page()));
    assert({
      given:
        'an older page requested, then a refresh that answers before it does',
      should:
        'keep Older messages busy until the older page itself answers, so it is not asked twice',
      actual: {
        asked: older.url.includes('before=5'),
        duringRefresh,
        after: chat.shown().paging,
      },
      expected: { asked: true, duringRefresh: true, after: false },
    });
  } finally {
    await chat.unmount();
  }
});

test('a slower earlier read never replaces what a later read said', async () => {
  const chat = await mount();
  try {
    await chat.act(() => chat.held().refresh());
    const slow = chat.reads.at(-1)!;
    await chat.act(() => chat.held().refresh());
    // The later read says the chat has closed to writing.
    await chat.act(() => chat.reads.at(-1)!.resolve(page(true, 1)));
    const closed = chat.shown().readOnly;
    await chat.act(() => slow.resolve(page(false, 0)));
    assert({
      given:
        'two reads of the chat, the first answering after the second with the chat still open',
      should: 'keep the later answer: the chat stays read-only',
      actual: { closed, after: chat.shown().readOnly },
      expected: { closed: true, after: true },
    });
  } finally {
    await chat.unmount();
  }
});

test('an older page never says what the chat is now', async () => {
  const chat = await mount();
  try {
    await chat.act(() => chat.held().loadOlder(5));
    const older = chat.reads.at(-1)!;
    await chat.act(() => chat.held().refresh());
    // The refresh says the chat has closed to writing; the older page was
    // read before that and answers after it.
    await chat.act(() => chat.reads.at(-1)!.resolve(page(true, 1)));
    await chat.act(() => older.resolve(page(false, 0)));
    assert({
      given:
        'an older page read while the chat was open, answering after a refresh that found it closed',
      should: 'add its messages and leave the chat read-only',
      actual: { ...chat.shown() },
      expected: { state: 'ready', readOnly: true, paging: false, notice: null },
    });
  } finally {
    await chat.unmount();
  }
});

test('a read is applied when it answers, though a later one is already on its way', async () => {
  const chat = await mount();
  try {
    await chat.act(() => chat.held().refresh());
    const first = chat.reads.at(-1)!;
    // Traffic keeps asking: the next read starts before the first answers.
    await chat.act(() => chat.held().refresh());
    await chat.act(() => first.resolve(page(true, 1)));
    assert({
      given:
        'a read answering while a later read of the same kind is in flight',
      should: 'apply it, so steady traffic cannot leave every answer dropped',
      actual: chat.shown().readOnly,
      expected: true,
    });
  } finally {
    await chat.unmount();
  }
});

test('a later read that fails does not cost an earlier one its answer', async () => {
  const chat = await mount();
  try {
    await chat.act(() => chat.held().refresh());
    const first = chat.reads.at(-1)!;
    await chat.act(() => chat.held().refresh());
    await chat.act(() => chat.reads.at(-1)!.reject(new Error('offline')));
    const failed = chat.shown().notice;
    await chat.act(() => first.resolve(page(true, 1)));
    assert({
      given:
        'a read still on its way when a later read fails, then answering well',
      should:
        'say the later read failed, then apply the page and take that back',
      actual: { failed: failed !== null, after: chat.shown() },
      expected: {
        failed: true,
        after: { state: 'ready', readOnly: true, paging: false, notice: null },
      },
    });
  } finally {
    await chat.unmount();
  }
});

test('a read asked before the chat was denied never reopens it', async () => {
  const chat = await mount();
  try {
    await chat.act(() => chat.held().refresh());
    const earlier = chat.reads.at(-1)!;
    await chat.act(() => chat.held().refresh());
    await chat.act(() =>
      chat.reads.at(-1)!.resolve(new Response(null, { status: 403 })),
    );
    const denied = chat.shown().state;
    await chat.act(() => earlier.resolve(page()));
    assert({
      given:
        'a read still on its way when a later read is refused access, then answering well',
      should: 'leave the chat denied',
      actual: { denied, after: chat.shown().state },
      expected: { denied: 'denied', after: 'denied' },
    });
  } finally {
    await chat.unmount();
  }
});

test('a denied chat holds nothing of the thread it lost', async () => {
  const chat = await mount();
  try {
    await chat.act(() => chat.held().loadOlder(5));
    await chat.act(() => chat.held().refresh());
    await chat.act(() =>
      chat.reads.at(-1)!.resolve(new Response(null, { status: 403 })),
    );
    assert({
      given: 'an older page on its way when a refresh is refused access',
      should: 'be denied alone: no page loading, and no notice beside it',
      actual: chat.shown(),
      expected: {
        state: 'denied',
        readOnly: null,
        paging: false,
        notice: null,
      },
    });
  } finally {
    await chat.unmount();
  }
});

test('a chat hidden before its first page reads it when the reader may see it again', async () => {
  const live = liveChannel();
  const chat = await mount(live, 'on its way');
  const sight = () => ({
    reads: chat.reads.length,
    hidden: chat.held().hidden,
    pending: chat.held().pending,
    history: chat.held().history?.changeVersion ?? null,
  });
  try {
    const entering = sight();
    await chat.act(() => live.revoke());
    // The page asked for before the chat was hidden answers into nothing.
    await chat.act(() => chat.reads[0]!.resolve(page(false, 3)));
    const hidden = sight();
    await chat.act(() => live.permit());
    const shownAgain = sight();
    await chat.act(() => chat.reads.at(-1)!.resolve(page(false, 4)));
    assert({
      given:
        'a chat whose live channel hides it while the first page is on its way, then shows it again',
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
    await chat.unmount();
  }
});

test('a chat hidden with its thread shown reads it afresh when shown again', async () => {
  const live = liveChannel();
  const chat = await mount(live);
  const sight = () => ({
    reads: chat.reads.length,
    hidden: chat.held().hidden,
    pending: chat.held().pending,
    history: chat.held().history?.changeVersion ?? null,
  });
  try {
    await chat.act(() => live.permit());
    const shown = sight();
    await chat.act(() => live.revoke());
    const hidden = sight();
    await chat.act(() => live.permit());
    const shownAgain = sight();
    await chat.act(() => chat.reads.at(-1)!.resolve(page(false, 2)));
    assert({
      given:
        'a chat with its thread shown, hidden by the live channel and then shown again',
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
    await chat.unmount();
  }
});

/** A reader who may not open the chat, with the test holding the check's timer and the page's visibility. */
const mountReader = async () => {
  const world = {
    discovery: () => Response.json({ version: 1, roundId, channel: null }),
    visible: true,
    discoveries: 0,
    timers: [] as { readonly ms: number; readonly work: () => void }[],
    stopped: 0,
  };
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./use-context-chat.test-support', import.meta.dir),
    {
      fetch: (url: string) => {
        if (url.includes('/messages')) return Promise.resolve(page(true));
        world.discoveries += 1;
        return Promise.resolve(world.discovery());
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
      for (let turn = 0; turn < 5; turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
  await act(() =>
    client.root.render(
      client.createElement(client.ContextChatProbe, {
        ownerId: roundId,
        actorId: 'a'.repeat(24),
        socketUrl: null,
        requestId: 'q'.repeat(24),
        readOnlyHint: true,
        sendAction: refuse,
        mutateAction: refuse,
        reportAction: refuse,
        hold: () => undefined,
        openingCheck: {
          everyMs: 15_000,
          every: (work, ms) => {
            const timer = { ms, work };
            world.timers.push(timer);
            return () => {
              world.stopped += 1;
              world.timers = world.timers.filter((other) => other !== timer);
            };
          },
          visible: () => world.visible,
        },
      }),
    ),
  );
  await act(() => undefined);
  return {
    world,
    act,
    /** The interval elapses once. */
    tick: () => act(() => world.timers.forEach((timer) => timer.work())),
    state: () =>
      (
        JSON.parse(client.container.querySelector('output')!.textContent!) as {
          state: string;
        }
      ).state,
    unmount: () => client.act(async () => client.root.unmount()),
  };
};

test('a reader who may not open the chat sees it once someone else opens it', async () => {
  const chat = await mountReader();
  try {
    const atFirst = {
      state: chat.state(),
      timers: chat.world.timers.map((timer) => timer.ms),
      discoveries: chat.world.discoveries,
    };
    chat.world.visible = false;
    await chat.tick();
    const whileHidden = chat.world.discoveries;
    chat.world.visible = true;
    await chat.tick();
    const stillEmpty = [chat.state(), chat.world.discoveries];
    chat.world.discovery = () => new Response(null, { status: 500 });
    await chat.tick();
    const afterFailure = [chat.state(), chat.world.timers.length];
    chat.world.discovery = () =>
      Response.json({ version: 1, roundId, channel: metadata(true) });
    await chat.tick();
    assert({
      given:
        'an empty chat its reader may not open, with the page hidden, then in view with no chat yet, a failed check and a check that finds the chat',
      should:
        'ask every 15 seconds only while in view, stay empty through none and a failure, then show the found chat and stop asking',
      actual: {
        atFirst,
        whileHidden,
        stillEmpty,
        afterFailure,
        found: chat.state(),
        timers: chat.world.timers.length,
        discoveries: chat.world.discoveries,
      },
      expected: {
        atFirst: { state: 'empty', timers: [15_000], discoveries: 1 },
        whileHidden: 1,
        stillEmpty: ['empty', 2],
        afterFailure: ['empty', 1],
        found: 'ready',
        timers: 0,
        discoveries: 4,
      },
    });
  } finally {
    await chat.unmount();
  }
});

test('the check for a chat opened by someone else ends when access is refused or the page leaves', async () => {
  const refused = await mountReader();
  const left = await mountReader();
  try {
    refused.world.discovery = () => new Response(null, { status: 404 });
    await refused.tick();
    const armed = left.world.timers.length;
    await left.unmount();
    assert({
      given:
        'an empty chat whose check is answered not found, and another whose page unmounts',
      should: 'end denied with no timer left, and stop the timer on unmount',
      actual: {
        refused: [refused.state(), refused.world.timers.length],
        left: [armed, left.world.timers.length],
      },
      expected: { refused: ['denied', 0], left: [1, 0] },
    });
  } finally {
    await refused.unmount();
  }
});
