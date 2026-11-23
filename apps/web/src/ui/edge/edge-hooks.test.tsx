import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import type * as Client from './edge-hooks.test-support';

setupRitewayBun();

const mount = () =>
  mountBrowserClient<typeof Client>(
    Bun.resolveSync('./edge-hooks.test-support', import.meta.dir),
  );

test('useResource holds one resource per key and disposes it on change and leave', async () => {
  const { act, createElement, root, HeldResource } = await mount();
  const log: string[] = [];
  const open = (key: string) => ({
    name: key,
    dispose: () => log.push(`dispose ${key}`),
  });
  const seen = (name: string | null) => log.push(`render ${name}`);
  const show = (resourceKey: string | null) =>
    act(async () =>
      root.render(createElement(HeldResource, { resourceKey, open, seen })),
    );
  await show('a');
  await show('b');
  await show(null);
  await show('c');
  await act(async () => root.unmount());
  assert({
    given: 'key a, then b, then no key, then c, then leaving',
    should:
      'render without a resource until it opens (and once more after a release), hand over the held one, and dispose each exactly once',
    actual: log,
    expected: [
      'render null',
      'render a',
      'render null',
      'dispose a',
      'render b',
      'render null',
      'dispose b',
      'render null',
      'render null',
      'render c',
      'dispose c',
    ],
  });
});

test('useAnswer tells each new value, never the seed; useDeliver tells every value', async () => {
  const { act, createElement, root, Answered, Delivered } = await mount();
  const answers: string[] = [];
  const deliveries: string[] = [];
  const show = (value: string) =>
    act(async () =>
      root.render(
        createElement('div', null, [
          createElement(Answered, {
            key: 'a',
            answer: value,
            told: (next) => answers.push(next),
          }),
          createElement(Delivered, {
            key: 'd',
            value,
            told: (next) => deliveries.push(next),
          }),
        ]),
      ),
    );
  await show('seed');
  await show('seed');
  await show('first');
  await show('first');
  await show('second');
  await act(async () => root.unmount());
  assert({
    given: 'the seed twice, a first answer twice, then a second',
    should: 'tell the answers once each and deliver every distinct value',
    actual: [answers, deliveries],
    expected: [
      ['first', 'second'],
      ['seed', 'first', 'second'],
    ],
  });
});

test('useDelay waits once per arming and useTick keeps its cadence', async () => {
  const { act, createElement, root, Waiting, Ticking, browser } = await mount();
  const timers = new Map<
    number,
    { run: () => void; ms: number; every: boolean }
  >();
  let next = 0;
  const realm = browser as unknown as Window;
  realm.setTimeout = ((run: () => void, ms: number) => {
    timers.set(++next, { run, ms, every: false });
    return next;
  }) as typeof realm.setTimeout;
  realm.clearTimeout = ((id: number) =>
    void timers.delete(id)) as typeof realm.clearTimeout;
  realm.setInterval = ((run: () => void, ms: number) => {
    timers.set(++next, { run, ms, every: true });
    return next;
  }) as typeof realm.setInterval;
  realm.clearInterval = ((id: number) =>
    void timers.delete(id)) as typeof realm.clearInterval;
  const fired: string[] = [];
  const fire = async () =>
    act(async () => {
      for (const [id, timer] of [...timers]) {
        if (!timer.every) timers.delete(id);
        timer.run();
      }
    });
  const show = (
    waitMs: number | null,
    waitKey: string,
    everyMs: number | null,
  ) =>
    act(async () =>
      root.render(
        createElement('div', null, [
          createElement(Waiting, {
            key: 'w',
            waitMs,
            waitKey,
            run: () => fired.push(`wait ${waitKey}`),
          }),
          createElement(Ticking, {
            key: 't',
            everyMs,
            run: () => fired.push('tick'),
          }),
        ]),
      ),
    );
  await show(500, 'one', 1000);
  const armed = [...timers.values()].map(({ ms, every }) => [ms, every]);
  await show(500, 'two', 1000);
  await fire();
  await fire();
  await show(null, 'two', null);
  const disarmed = timers.size;
  await act(async () => root.unmount());
  assert({
    given:
      'a wait armed, re-armed by a new key, fired, then everything disarmed',
    should:
      'hold one wait and one cadence, fire the wait once for its latest arming, tick on, and leave no timer',
    actual: [armed, fired, disarmed],
    expected: [
      [
        [500, false],
        [1000, true],
      ],
      ['tick', 'wait two', 'tick'],
      0,
    ],
  });
});

test('useMediaQuery answers the browser after the server answer', async () => {
  const { act, createElement, root, Matching, container, browser } =
    await mount();
  const listeners = new Set<() => void>();
  let matches = false;
  (browser as unknown as Window).matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  })) as unknown as Window['matchMedia'];
  await act(async () =>
    root.render(createElement(Matching, { query: '(width < 901px)' })),
  );
  const before = container.textContent;
  matches = true;
  await act(async () => {
    for (const listener of listeners) listener();
  });
  const after = container.textContent;
  await act(async () => root.unmount());
  assert({
    given: 'a query that starts unmatched and then matches',
    should: 'show each answer and release its listener',
    actual: [before, after, listeners.size],
    expected: ['false', 'true', 0],
  });
});

test('focus moves on a later change and leaves a row for its neighbour', async () => {
  const { act, createElement, root, FocusOnChange, LeavingRow, browser } =
    await mount();
  const active = () => {
    const element = browser.document.activeElement;
    return element?.tagName === 'BUTTON' ? element.textContent : null;
  };
  await act(async () => root.render(createElement(FocusOnChange, { step: 1 })));
  const first = active();
  await act(async () => root.render(createElement(FocusOnChange, { step: 2 })));
  const changed = active();
  await act(async () =>
    root.render(createElement(LeavingRow, { shown: true })),
  );
  await act(async () =>
    (
      browser.document.getElementById('inside') as unknown as HTMLElement
    ).focus(),
  );
  await act(async () =>
    root.render(createElement(LeavingRow, { shown: false })),
  );
  const left = active();
  await act(async () => root.unmount());
  assert({
    given: 'a first render, a changed key, then a focused row leaving',
    should: 'move nothing first, then focus the control, then its neighbour',
    actual: [first, changed, left],
    expected: [null, 'Step 2', 'After'],
  });
});

test('useSettled keeps only the result of the key it was read for', async () => {
  const { act, createElement, root, Settled } = await mount();
  const reads = new Map<string, (value: string) => void>();
  const read = (key: string) =>
    new Promise<string>((done) => reads.set(key, done));
  const shown: string[] = [];
  const show = (readKey: string | null) =>
    act(async () =>
      root.render(
        createElement(Settled, { readKey, read, seen: (s) => shown.push(s) }),
      ),
    );
  await show('a');
  await show('b');
  await act(async () => reads.get('a')?.('from a'));
  const afterStale = shown.at(-1);
  await act(async () => reads.get('b')?.('from b'));
  const afterCurrent = shown.at(-1);
  await act(async () => root.unmount());
  assert({
    given: 'a read for a, the key moving to b, then a answering before b',
    should: 'drop a’s late answer and show b’s',
    actual: [afterStale, afterCurrent],
    expected: ['none', 'from b'],
  });
});
