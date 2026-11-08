import type { Page, Response as PageResponse } from '@playwright/test';

/** Test-only consumer observation; returns every native operation unchanged. */
export function observeRecoveryConsumer(
  response: Response,
  changed: () => void,
) {
  const state = {
    readerOpened: false,
    eof: false,
    readRejected: false,
    readerCancelled: false,
    bodyCancelled: false,
    lockReleased: false,
  };
  const body = response.body;
  if (body === null) return state;
  const getReader = body.getReader.bind(body);
  const cancelBody = body.cancel.bind(body);
  body.cancel = (...args) => {
    state.bodyCancelled = true;
    changed();
    return cancelBody(...args);
  };
  body.getReader = ((...args: Parameters<typeof getReader>) => {
    const reader = Reflect.apply(
      getReader,
      body,
      args,
    ) as ReadableStreamDefaultReader<Uint8Array>;
    state.readerOpened = true;
    const read = reader.read.bind(reader);
    const cancel = reader.cancel.bind(reader);
    const release = reader.releaseLock.bind(reader);
    reader.read = ((...readArgs: Parameters<typeof read>) => {
      const original = read(...readArgs);
      void original.then(
        (answer) => {
          if (answer.done) {
            state.eof = true;
            changed();
          }
        },
        () => {
          state.readRejected = true;
          changed();
        },
      );
      return original;
    }) as typeof reader.read;
    reader.cancel = (...cancelArgs) => {
      state.readerCancelled = true;
      changed();
      return cancel(...cancelArgs);
    };
    reader.releaseLock = () => {
      state.lockReleased = true;
      changed();
      return release();
    };
    changed();
    return reader;
  }) as typeof body.getReader;
  return state;
}

/** One hypothesis witness on the real consumer, with private HTTP correlation only. */
export async function watchRecoveryConsumer(
  page: Page,
  target:
    | { readonly kind: 'conversation'; readonly channelId: string }
    | { readonly kind: 'shell-home' },
) {
  const pathname =
    target.kind === 'shell-home' ? '/' : `/messages/${target.channelId}`;
  const observations = new Map<string, Record<string, boolean>>();
  await page.exposeFunction(
    '__messagingRecoveryConsumer',
    (id: string, value: Record<string, boolean>) => {
      const fields = [
        'readerOpened',
        'eof',
        'readRejected',
        'readerCancelled',
        'bodyCancelled',
        'lockReleased',
        'signalSupplied',
        'signalAborted',
      ] as const;
      if (
        typeof id !== 'string' ||
        fields.some((field) => typeof value[field] !== 'boolean')
      )
        return;
      if (!observations.has(id) && observations.size >= 4) return;
      observations.set(
        id,
        Object.fromEntries(fields.map((field) => [field, value[field]!])),
      );
    },
  );
  await page.addInitScript({
    content: `(${installRecoveryConsumer.toString()})(${JSON.stringify(pathname)}, ${observeRecoveryConsumer.toString()});`,
  });
  return (response: PageResponse) => {
    const value = observations.get(response.headers()['x-request-id'] ?? '');
    return { sameHttpCorrelation: value !== undefined, ...(value ?? {}) };
  };
}

function installRecoveryConsumer(
  pathname: string,
  observe: typeof observeRecoveryConsumer,
) {
  const notify = (
    window as unknown as {
      __messagingRecoveryConsumer: (id: string, state: object) => Promise<void>;
    }
  ).__messagingRecoveryConsumer;
  const fetch = window.fetch.bind(window);
  window.fetch = Object.assign((...args: Parameters<typeof fetch>) => {
    const original = fetch(...args);
    const [input, init] = args;
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.href,
    );
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (
      method.toUpperCase() !== 'GET' ||
      url.pathname !== pathname ||
      headers.get('rsc') !== '1' ||
      headers.get('next-router-prefetch') === '1'
    )
      return original;
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : null);
    let signalAborted = signal?.aborted ?? false;
    let emit = () => {};
    signal?.addEventListener(
      'abort',
      () => {
        signalAborted = true;
        emit();
      },
      { once: true },
    );
    void original.then(
      (response) => {
        const id = response.headers.get('x-request-id');
        if (id === null) return;
        const state = observe(response, () => emit());
        emit = () => {
          void notify(id, {
            ...state,
            signalSupplied: signal !== null,
            signalAborted,
          }).catch(() => {});
        };
        emit();
      },
      () => {},
    );
    return original;
  }, window.fetch);
}
