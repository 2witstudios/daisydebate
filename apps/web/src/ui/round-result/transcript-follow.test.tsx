import { Window as BrowserWindow } from 'happy-dom';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type * as FollowClient from './transcript-follow.test-support';

setupRitewayBun();

/** The real component and React in an isolated browser realm with fixed layout. */
async function mounted() {
  const browser = new BrowserWindow({ url: 'https://daisy.test/' });
  const built = await Bun.build({
    entrypoints: [
      Bun.resolveSync('./transcript-follow.test-support', import.meta.dir),
    ],
    format: 'cjs',
    target: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  if (!built.success) throw new Error('Follow client failed to build');
  const resized: (() => void)[] = [];
  const { act, createElement, createRoot, TranscriptFollow } = runInNewContext(
    `${await built.outputs[0]!.text()}; module.exports;`,
    {
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
      ResizeObserver: class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    },
  ) as typeof FollowClient;
  const host = browser.document.createElement('div');
  browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const render = (line: string) =>
    act(() =>
      root.render(
        createElement(TranscriptFollow, null, createElement('p', null, line)),
      ),
    );
  await render('first');
  const lines = host.querySelector('[role="group"]') as unknown as HTMLElement;
  Object.defineProperty(lines, 'clientHeight', { value: 100 });
  Object.defineProperty(lines, 'scrollHeight', { value: 1000 });
  return {
    lines,
    render,
    latest: () =>
      [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Latest',
      ) as unknown as HTMLElement | undefined,
    scroll: () =>
      act(() => {
        lines.dispatchEvent(
          new browser.Event('scroll', { bubbles: true }) as unknown as Event,
        );
      }),
    resize: () => act(() => resized.at(-1)?.()),
    click: (element: HTMLElement) => act(() => element.click()),
  };
}

test('new lines and a resize pin the list while following', async () => {
  const view = await mounted();
  await view.render('second');
  const afterLine = view.lines.scrollTop;
  view.lines.scrollTop = 900;
  await view.resize();
  assert({
    given: 'a following list, a new line, then a resize',
    should: 'write the end position and offer no Latest',
    actual: [afterLine, view.lines.scrollTop, view.latest() === undefined],
    expected: [1000, 1000, true],
  });
});

test('a reader stays put and Latest brings them back', async () => {
  const view = await mounted();
  await view.render('second');
  view.lines.scrollTop = 0;
  await view.render('third');
  const afterRender = view.lines.scrollTop;
  await view.resize();
  const afterResize = view.lines.scrollTop;
  await view.scroll();
  const offered = view.latest() !== undefined;
  await view.click(view.latest()!);
  assert({
    given: 'a move up, a render before its scroll event, a resize, then Latest',
    should:
      'hold the position through both, offer Latest, and return to the end',
    actual: [
      afterRender,
      afterResize,
      offered,
      view.lines.scrollTop,
      view.latest() === undefined,
    ],
    expected: [0, 0, true, 1000, true],
  });
});
