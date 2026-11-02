import { Window as BrowserWindow } from 'happy-dom';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import type * as LifecycleClient from './use-second-lifecycle.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

test('useSecond refreshes from the shared clock and releases every mounted effect', async () => {
  const browser = new BrowserWindow({ url: 'https://daisy.test/' });
  // Compile the real hook and React into an isolated browser realm: tests
  // inject that realm's resources without changing the runner's globals.
  const built = await Bun.build({
    entrypoints: [
      Bun.resolveSync('./use-second-lifecycle.test-support', import.meta.dir),
    ],
    format: 'cjs',
    target: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  if (!built.success) throw new Error('Clock lifecycle client failed to build');
  const { act, createElement, createRoot, useSecond, createRoundTime } =
    runInNewContext(`${await built.outputs[0]!.text()}; module.exports;`, {
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
      module: { exports: {} },
      setTimeout,
      clearTimeout,
      queueMicrotask,
      console,
      MessageChannel,
    }) as typeof LifecycleClient;

  let mono = 0;
  const clock = createRoundTime({
    monotonicNowMs: () => mono,
    hydrationSeedServerMs: 10000,
  });
  let subscriptions = 0;
  const shared = {
    ...clock,
    subscribe: (listener: () => void) => {
      subscriptions++;
      const stop = clock.subscribe(listener);
      return () => {
        subscriptions--;
        stop();
      };
    },
  };
  const realmWindow = browser as unknown as Window;
  const realmDocument = browser.document as unknown as Document;
  const intervals = new Map<number, () => void>();
  let intervalMs: number | undefined;
  let nextInterval = 0;
  realmWindow.setInterval = (callback: TimerHandler, ms?: number) => {
    if (typeof callback !== 'function')
      throw new Error('Clock interval must be a function');
    intervalMs = ms;
    const id = ++nextInterval;
    intervals.set(id, callback as () => void);
    return id;
  };
  realmWindow.clearInterval = (id?: number) => {
    if (id !== undefined) intervals.delete(id);
  };
  const visibility = new Set<unknown>();
  const add = realmDocument.addEventListener.bind(realmDocument);
  const remove = realmDocument.removeEventListener.bind(realmDocument);
  realmDocument.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'visibilitychange') visibility.add(listener);
    return add(type, listener, options);
  }) as typeof realmDocument.addEventListener;
  realmDocument.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === 'visibilitychange') visibility.delete(listener);
    return remove(type, listener, options);
  }) as typeof realmDocument.removeEventListener;
  let state: DocumentVisibilityState = 'visible';
  Object.defineProperty(browser.document, 'visibilityState', {
    get: () => state,
  });
  const container = browser.document.createElement('div');
  browser.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  function Clock({ owner }: { readonly owner: typeof shared }) {
    return createElement('time', null, useSecond(10000, owner));
  }
  try {
    await act(async () => root.render(createElement(Clock, { owner: shared })));
    assert({
      given: 'the live clock mounted after its server seed',
      should:
        'own one clock subscription, one second interval and one visible-tab listener',
      actual: [
        container.textContent,
        subscriptions,
        intervalMs,
        intervals.size,
        visibility.size,
      ],
      expected: ['10000', 1, 1000, 1, 1],
    });
    await act(async () => {
      mono = 20;
      clock.sample({
        serverNowMs: 20000,
        sentAtMs: 0,
        receivedAtMs: 20,
        generation: 1,
      });
    });
    const calibrated = container.textContent;
    await act(async () => {
      mono = 1020;
      for (const tick of intervals.values()) tick();
    });
    const interval = container.textContent;
    await act(async () => {
      mono = 1520;
      state = 'hidden';
      browser.document.dispatchEvent(new browser.Event('visibilitychange'));
    });
    const hidden = container.textContent;
    await act(async () => {
      mono = 2020;
      state = 'visible';
      browser.document.dispatchEvent(new browser.Event('visibilitychange'));
    });
    assert({
      given:
        'accepted calibration, a one-second tick, hiding, and returning visible',
      should:
        'show shared-clock corrections and elapsed time while refreshing on visibility return',
      actual: [calibrated, interval, hidden, container.textContent],
      expected: ['20010', '21010', '21010', '22010'],
    });
    const replacementClock = createRoundTime({
      monotonicNowMs: () => mono,
      hydrationSeedServerMs: 30000,
    });
    let replacementSubscriptions = 0;
    const replacement = {
      ...replacementClock,
      subscribe: (listener: () => void) => {
        replacementSubscriptions++;
        const stop = replacementClock.subscribe(listener);
        return () => {
          replacementSubscriptions--;
          stop();
        };
      },
    };
    await act(async () =>
      root.render(createElement(Clock, { owner: replacement })),
    );
    const replaced = container.textContent;
    await act(async () => {
      clock.sample({
        serverNowMs: 40000,
        sentAtMs: mono,
        receivedAtMs: mono,
        generation: 2,
      });
    });
    assert({
      given:
        'a replacement clock owner, then a notification from the old clock',
      should:
        'render the replacement and detach the old owner without accumulating effects',
      actual: [
        replaced,
        container.textContent,
        subscriptions,
        replacementSubscriptions,
        intervals.size,
        visibility.size,
      ],
      expected: ['30000', '30000', 0, 1, 1, 1],
    });
    await act(async () => root.unmount());
    assert({
      given: 'the Round clock display unmounted',
      should:
        'release its clock subscription, interval and visibility listener',
      actual: [
        subscriptions,
        replacementSubscriptions,
        intervals.size,
        visibility.size,
      ],
      expected: [0, 0, 0, 0],
    });
  } finally {
    await act(async () => root.unmount());
    await browser.happyDOM.close();
  }
});
