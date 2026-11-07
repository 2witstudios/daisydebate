/** Mounted installed App Router Link; cancellation never reaches a router stub. */
import { mock } from 'bun:test';
import { Window } from 'happy-dom';
const win = new Window({ url: 'https://daisy.test/messages/channel' });
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLAnchorElement',
  'Event',
  'MouseEvent',
  'Node',
  'self',
  'location',
] as const)
  Object.defineProperty(globalThis, key, {
    value: key === 'window' || key === 'self' ? win : win[key],
    configurable: true,
  });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});
const { act, StrictMode, createElement: h } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AppRouterContext } =
  await import('next/dist/shared/lib/app-router-context.shared-runtime');
// Prefetch machinery has no browser bundle in Bun; cancellation uses actual Link code.
mock.module('next/dist/client/components/links', () => ({
  IDLE_LINK_STATUS: { pending: false },
  mountLinkInstance: () => ({}),
  onNavigationIntent() {},
  unmountLinkForCurrentNavigation() {},
  unmountPrefetchableInstance() {},
}));
const { default: AppLink } = await import('next/dist/client/app-dir/link');
mock.module('next/link', () => ({ default: AppLink }));
const { ShellLink } = await import('../src/ui/layout/app-shell/shell-link');
const { shellNavigationEvent } =
  await import('../src/ui/layout/app-shell/shell-navigation');
const { useMovedOn } = await import('../src/ui/form-action/use-moved-on');
const calls: string[] = [];
let cancelled = 0,
  notices = 0;
win.document.addEventListener(shellNavigationEvent, () => {
  notices += 1;
});
const router = {
  bfcacheId: 'shell-mounted-proof',
  back() {},
  forward() {},
  refresh() {},
  prefetch() {},
  push() {
    throw new Error('Cancelled Link reached navigation');
  },
  replace(href: string) {
    calls.push(`replace:${href}`);
  },
};
function Answer({
  next,
  before,
}: {
  readonly next?: string;
  readonly before: () => void;
}) {
  useMovedOn(next, before);
  return null;
}
const host = win.document.createElement('div');
win.document.body.append(host);
const root = createRoot(host as unknown as HTMLElement);
const render = (
  next?: string,
  before = () => {
    calls.push('before-one');
  },
) =>
  h(
    StrictMode,
    null,
    h(
      AppRouterContext.Provider,
      { value: router },
      h(
        ShellLink,
        {
          href: '/other',
          prefetch: false,
          onNavigate: (event) => {
            cancelled += 1;
            event.preventDefault();
          },
        },
        'Cancelled choice',
      ),
      h(Answer, { ...(next === undefined ? {} : { next }), before }),
    ),
  );
try {
  await act(async () => {
    root.render(render());
  });
  const click = new win.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    host.querySelector('a')!.dispatchEvent(click);
  });
  await act(async () => {
    root.render(render('/messages/newer'));
  });
  await act(async () => {
    root.render(
      render('/messages/newer', () => {
        calls.push('before-two');
      }),
    );
  });
  process.stdout.write(
    JSON.stringify({
      cancelled,
      prevented: click.defaultPrevented,
      notices,
      calls,
    }),
  );
} finally {
  await act(async () => {
    root.unmount();
  });
  await win.happyDOM.close();
}
