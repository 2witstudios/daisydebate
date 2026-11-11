import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
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
const refuse = async () => ({ text: '', requestId: 'q'.repeat(24) });

/** The hook in a private realm; the test answers each history read in its own time. */
const mount = async () => {
  const reads: (ReturnType<typeof Promise.withResolvers<Response>> & {
    readonly url: string;
  })[] = [];
  let held: Parameters<Parameters<typeof client.FloorProbe>[0]['hold']>[0];
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./use-floor-chat.test-support', import.meta.dir),
    {
      fetch: (url: string) => {
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
        socketUrl: null,
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
  await act(() => reads[0]!.resolve(page()));
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
    await floor.act(() => void floor.held().loadHistory(channelId, 5));
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
    await floor.act(() => void floor.held().loadHistory(channelId, 5));
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
