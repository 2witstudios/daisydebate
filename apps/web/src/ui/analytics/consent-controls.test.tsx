import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Consent } from '../../features/analytics/consent';
import { ConsentControls } from './consent-controls';

setupRitewayBun();

const noop = () => {};
const router = {
  bfcacheId: 'test',
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};
const render = (node: ReactNode) =>
  renderToString(<AppRouterContext value={router}>{node}</AppRouterContext>);

test('an unreadable stored choice offers no form to overwrite it', () => {
  const available = { analytics: true, replay: false };
  const consent = {
    version: 1,
    necessary: 'granted',
    analytics: 'granted',
    replay: 'unanswered',
  } as Consent;
  const readable = render(
    <ConsentControls
      choice={{ kind: 'known', consent }}
      available={available}
    />,
  );
  const unreadable = render(
    <ConsentControls choice={{ kind: 'unreadable' }} available={available} />,
  );
  assert({
    given: 'a readable choice, and a choice a refusal left unreadable',
    should: 'show the form only for the readable one, and say why otherwise',
    actual: [
      readable.includes('<form'),
      unreadable.includes('<form'),
      unreadable.includes('role="status"'),
    ],
    expected: [true, false, true],
  });
});
