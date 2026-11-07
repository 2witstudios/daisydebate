import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observeRecoveryConsumer } from '../e2e/support/messaging-recovery-consumer';
setupRitewayBun();

test('the actual consumer reader retains its read promise and reports successful EOF separately', async () => {
  const response = new Response('controlled bytes');
  const seen: ReturnType<typeof observeRecoveryConsumer>[] = [];
  const state = observeRecoveryConsumer(response, () =>
    seen.push({ ...state }),
  );
  const reader = response.body!.getReader();
  const first = await reader.read();
  await reader.read();
  assert({
    given: 'the real body consumer reads its own stream to EOF',
    should:
      'observe its successful EOF without issuing an extra read or changing bytes',
    actual: {
      text: new TextDecoder().decode(first.value),
      opened: state.readerOpened,
      eof: state.eof,
      rejected: state.readRejected,
      cancel: state.readerCancelled,
    },
    expected: {
      text: 'controlled bytes',
      opened: true,
      eof: true,
      rejected: false,
      cancel: false,
    },
  });
});

test('an explicit reader cancellation is distinct from an upstream read rejection', async () => {
  const cancelResponse = new Response(new ReadableStream());
  const cancelled = observeRecoveryConsumer(cancelResponse, () => {});
  await cancelResponse.body!.getReader().cancel();
  const failure = new Error('controlled transport rejection');
  const failedResponse = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(failure);
      },
    }),
  );
  const failed = observeRecoveryConsumer(failedResponse, () => {});
  const sameFailure = await failedResponse
    .body!.getReader()
    .read()
    .then(
      () => false,
      (error) => error === failure,
    );
  assert({
    given: 'one consumer cancels and another receives a failed upstream read',
    should:
      'keep cancellation distinct and preserve the actual rejection identity',
    actual: {
      cancelled: cancelled.readerCancelled,
      cancelEof: cancelled.eof,
      failed: failed.readRejected,
      failedCancel: failed.readerCancelled,
      sameFailure,
    },
    expected: {
      cancelled: true,
      cancelEof: false,
      failed: true,
      failedCancel: false,
      sameFailure: true,
    },
  });
});

test('observation returns the original reader promise and never initiates a read', async () => {
  const promised = Promise.resolve({ done: true as const, value: undefined });
  let reads = 0;
  const reader = {
    read: () => {
      reads++;
      return promised;
    },
    cancel: () => Promise.resolve(),
    releaseLock: () => {},
  };
  const response = {
    body: { getReader: () => reader, cancel: () => Promise.resolve() },
  } as unknown as Response;
  const state = observeRecoveryConsumer(response, () => {});
  const before = reads;
  const actualReader = response.body!.getReader();
  const returned = actualReader.read();
  await returned;
  assert({
    given:
      'an existing native reader and pending operation owned by the decoder',
    should:
      'perform zero eager reads and preserve reader and promise identities',
    actual: {
      before,
      reads,
      reader: actualReader === reader,
      promise: returned === promised,
      eof: state.eof,
    },
    expected: { before: 0, reads: 1, reader: true, promise: true, eof: true },
  });
});

test('the serialized page witness preserves fetch identity and excludes speculative or unrelated responses', async () => {
  const { watchRecoveryConsumer } =
    await import('../e2e/support/messaging-recovery-consumer');
  let binding: (id: string, value: Record<string, boolean>) => void = () => {};
  let script = '';
  const page = {
    exposeFunction: async (_name: string, callback: typeof binding) => {
      binding = callback;
    },
    addInitScript: async ({ content }: { content: string }) => {
      script = content;
    },
  } as unknown as import('@playwright/test').Page;
  const snapshot = await watchRecoveryConsumer(page, 'controlled');
  const response = new Response('actual bytes', {
    headers: { 'x-request-id': 'private-controlled-correlation' },
  });
  const promised = Promise.resolve(response);
  const browser = {
    fetch: () => promised,
    __messagingRecoveryConsumer: async (
      id: string,
      value: Record<string, boolean>,
    ) => binding(id, value),
  };
  // Execute precisely the script installed before the real page's first target read.
  new Function('window', 'location', script)(browser, {
    href: 'https://example.invalid/messages/controlled',
  });
  const other = browser.fetch;
  const invoke = browser.fetch as unknown as typeof fetch;
  await invoke('/messages/other', { headers: { rsc: '1' } });
  await invoke('/messages/controlled', {
    headers: { rsc: '1', 'next-router-prefetch': '1' },
  });
  const selected = {
    headers: () => ({ 'x-request-id': 'private-controlled-correlation' }),
  } as unknown as import('@playwright/test').Response;
  const absent = snapshot(selected);
  const returned = invoke('/messages/controlled', { headers: { rsc: '1' } });
  await returned;
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();
  assert({
    given:
      'the installed exact-target fetch witness sees unrelated, prefetch and actual reads',
    should:
      'emit only its actual target consumer, preserving its original promise and EOF',
    actual: {
      absent,
      promise: returned === promised,
      wrapperInstalled: other !== undefined,
      target: snapshot(selected),
    },
    expected: {
      absent: { sameHttpCorrelation: false },
      promise: true,
      wrapperInstalled: true,
      target: {
        sameHttpCorrelation: true,
        readerOpened: true,
        eof: true,
        readRejected: false,
        readerCancelled: false,
        bodyCancelled: false,
        lockReleased: false,
        signalSupplied: false,
        signalAborted: false,
      },
    },
  });
});
