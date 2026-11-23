import { Window as BrowserWindow } from 'happy-dom';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import type { Root } from 'react-dom/client';

const windowPorts = [
  'fetch',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
] as const;

/** Real React and client code in a private browser realm, without runner globals. */
export async function mountBrowserClient<
  T extends { createRoot: (container: HTMLElement) => Root },
>(entrypoint: string, globals: Readonly<Record<string, unknown>> = {}) {
  const browser = new BrowserWindow({ url: 'https://daisy.test/' });
  const built = await Bun.build({
    entrypoints: [entrypoint],
    format: 'cjs',
    target: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  if (!built.success) throw new Error('Browser test client failed to build');
  const client = runInNewContext(
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
        observe() {}
        disconnect() {}
      },
      ...globals,
    },
  ) as T;
  // The browser ports read the window's transport and timers: what a test
  // injects as a realm global is what the window answers too.
  for (const name of windowPorts)
    if (name in globals) Object.assign(browser, { [name]: globals[name] });
  const container = browser.document.createElement('div');
  browser.document.body.append(container);
  const root = client.createRoot(container as unknown as HTMLElement);
  return { ...client, container, browser, root };
}
