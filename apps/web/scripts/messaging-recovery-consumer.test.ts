import { sha256Hex } from '@daisy/digest';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { boundedStep } from '../e2e/support/bounded-step';
import { observeRecoveryConsumer } from '../e2e/support/messaging-recovery-consumer';
setupRitewayBun();

const digestOf = async (bytes: Uint8Array) => sha256Hex(bytes);

test('the actual consumer reader retains its read promise and reports successful EOF separately', async () => {
  const response = new Response('controlled bytes');
  const seen: ReturnType<typeof observeRecoveryConsumer>[] = [];
  const state = observeRecoveryConsumer(
    response,
    () => seen.push({ ...state }),
    digestOf,
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
  const cancelled = observeRecoveryConsumer(cancelResponse, () => {}, digestOf);
  await cancelResponse.body!.getReader().cancel();
  const failure = new Error('controlled transport rejection');
  const failedResponse = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(failure);
      },
    }),
  );
  const failed = observeRecoveryConsumer(failedResponse, () => {}, digestOf);
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
  const state = observeRecoveryConsumer(response, () => {}, digestOf);
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
  let binding: (id: string, value: Record<string, unknown>) => void = () => {};
  let digestBinding: (base64: string) => Promise<string> = async () => '';
  let script = '';
  const page = {
    exposeFunction: async (
      name: string,
      callback: typeof binding & typeof digestBinding,
    ) => {
      if (name === '__messagingRecoveryDigest') digestBinding = callback;
      else binding = callback;
    },
    addInitScript: async ({ content }: { content: string }) => {
      script = content;
    },
  } as unknown as import('@playwright/test').Page;
  const snapshot = await watchRecoveryConsumer(page, {
    kind: 'conversation',
    channelId: 'controlled',
  });
  const response = new Response('actual bytes', {
    headers: { 'x-request-id': 'private-controlled-correlation' },
  });
  const promised = Promise.resolve(response);
  const digestReady = Promise.withResolvers<void>();
  const browser = {
    fetch: () => promised,
    __messagingRecoveryDigest: (base64: string) => digestBinding(base64),
    __messagingRecoveryConsumer: async (
      id: string,
      value: Record<string, unknown>,
    ) => {
      binding(id, value);
      if (
        typeof value['bodyDigest'] === 'string' ||
        value['digestFailed'] === true
      )
        digestReady.resolve();
    },
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
  await invoke('/messages/controlled', {
    method: 'POST',
    headers: { rsc: '1' },
  });
  const selected = {
    headers: () => ({ 'x-request-id': 'private-controlled-correlation' }),
  } as unknown as import('@playwright/test').Response;
  const absent = snapshot(selected);
  const returned = invoke('/messages/controlled', { headers: { rsc: '1' } });
  await returned;
  await snapshot.expectBody(
    'private-controlled-correlation',
    new TextEncoder().encode('actual bytes'),
  );
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();
  await boundedStep(
    'the serialized consumer digest',
    () => digestReady.promise,
    1000,
  );
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
      absent: { sameHttpCorrelation: false, bytesMatch: false },
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
        byteLength: 12,
        byteLimitExceeded: false,
        digestFailed: false,
        bytesMatch: true,
        signalSupplied: false,
        signalAborted: false,
      },
    },
  });
});

test('the same passive witness observes only the accepted Home GET consumer', async () => {
  const { watchRecoveryConsumer } =
    await import('../e2e/support/messaging-recovery-consumer');
  let binding: (id: string, value: Record<string, boolean>) => void = () => {};
  let digestBinding: (base64: string) => Promise<string> = async () => '';
  let script = '';
  const page = {
    exposeFunction: async (
      name: string,
      callback: typeof binding & typeof digestBinding,
    ) => {
      if (name === '__messagingRecoveryDigest') digestBinding = callback;
      else binding = callback;
    },
    addInitScript: async ({ content }: { content: string }) => {
      script = content;
    },
  } as unknown as import('@playwright/test').Page;
  const snapshot = await watchRecoveryConsumer(page, { kind: 'shell-home' });
  const response = new Response('actual Home bytes', {
    headers: { 'x-request-id': 'private-home-correlation' },
  });
  const original = Promise.resolve(response);
  const browser = {
    fetch: () => original,
    __messagingRecoveryDigest: (base64: string) => digestBinding(base64),
    __messagingRecoveryConsumer: async (
      id: string,
      value: Record<string, boolean>,
    ) => binding(id, value),
  };
  new Function('window', 'location', script)(browser, {
    href: 'https://example.invalid/messages/controlled',
  });
  const invoke = browser.fetch as unknown as typeof fetch;
  const selected = {
    headers: () => ({ 'x-request-id': 'private-home-correlation' }),
  } as unknown as import('@playwright/test').Response;
  await invoke('/messages/controlled', { headers: { rsc: '1' } });
  const unrelated = snapshot(selected);
  const returned = invoke('/', { headers: { rsc: '1' } });
  await returned;
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();
  assert({
    given: 'an accepted Home RSC GET after unrelated conversation data',
    should:
      'observe only its actual decoder EOF without replacing the fetch promise',
    actual: {
      unrelated,
      samePromise: returned === original,
      result: snapshot(selected),
    },
    expected: {
      unrelated: { sameHttpCorrelation: false, bytesMatch: false },
      samePromise: true,
      result: {
        sameHttpCorrelation: true,
        readerOpened: true,
        eof: true,
        readRejected: false,
        readerCancelled: false,
        bodyCancelled: false,
        lockReleased: false,
        byteLength: 17,
        byteLimitExceeded: false,
        digestFailed: false,
        bytesMatch: false,
        signalSupplied: false,
        signalAborted: false,
      },
    },
  });
});

test('consumed bytes identify the exact response independently of network termination', async () => {
  const bytes = new TextEncoder().encode('actual Flight 🌼\nrequest-identity');
  const digest = sha256Hex(bytes);
  const consume = async (parts: Uint8Array[]) => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    );
    const digestReady = Promise.withResolvers<void>();
    const state = observeRecoveryConsumer(
      response,
      () => {
        if (state.bodyDigest !== null || state.digestFailed)
          digestReady.resolve();
      },
      digestOf,
    );
    const reader = response.body!.getReader();
    while (!(await reader.read()).done) {
      /* the real consumer owns reads */
    }
    await boundedStep(
      'the exact-byte control digest',
      () => digestReady.promise,
      1000,
    );
    return {
      eof: state.eof,
      digestComputed: state.bodyDigest !== null && !state.digestFailed,
      bytesMatch: state.bodyDigest === digest,
      byteLength: state.byteLength,
    };
  };
  const exact = await consume([bytes.slice(0, 15), bytes.slice(15)]);
  const truncated = await consume([bytes.slice(0, -1)]);
  const corrupted = bytes.slice();
  corrupted[0] = 0;
  const wrongIdentity = new TextEncoder().encode(
    'actual Flight 🌼\nother---identity',
  );
  assert({
    given:
      'exact chunks, a truncated body, a corrupted body and another refusal identity',
    should:
      'prove only the exact consumed bytes even when every stream reaches EOF',
    actual: {
      exact,
      truncated,
      corrupted: await consume([corrupted]),
      wrongIdentity: await consume([wrongIdentity]),
    },
    expected: {
      exact: {
        eof: true,
        digestComputed: true,
        bytesMatch: true,
        byteLength: bytes.length,
      },
      truncated: {
        eof: true,
        digestComputed: true,
        bytesMatch: false,
        byteLength: bytes.length - 1,
      },
      corrupted: {
        eof: true,
        digestComputed: true,
        bytesMatch: false,
        byteLength: bytes.length,
      },
      wrongIdentity: {
        eof: true,
        digestComputed: true,
        bytesMatch: false,
        byteLength: wrongIdentity.length,
      },
    },
  });
});
