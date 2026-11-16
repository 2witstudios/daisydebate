import { renderToStaticMarkup } from 'react-dom/server';
import {
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { unavailableAction, linkTo } from '../../../features/tab/action';
import { WithAppRouter } from '../../test-support/app-router';
import { ActionButton } from './action-control';
import { SampleActionNotice } from '../../components/sample-action/sample-action-notice';
setupRitewayBun();
const render = (path: string) =>
  renderToStaticMarkup(
    <WithAppRouter>
      <PathnameContext value={path}>
        <SearchParamsContext value={new URLSearchParams('did=Invite')}>
          <SampleActionNotice />
          <ActionButton action={unavailableAction('Invite')} />
          <ActionButton
            action={linkTo('Entries', '/host/tournaments/autumn-open/entries')}
          />
        </SearchParamsContext>
      </PathnameContext>
    </WithAppRouter>,
  );
describe('Tab action availability', () => {
  test('production cannot simulate an unavailable operation', () => {
    const html = render('/host/tournaments/autumn-open/entries');
    assert({
      given:
        'a real page with an unavailable operation and a working navigation link',
      should:
        'disable the operation without a sample answer and retain the real destination',
      actual: [
        /<button[^>]*disabled/.test(html),
        html.includes('did='),
        html.includes('sample data'),
        html.includes('href="/host/tournaments/autumn-open/entries"'),
      ],
      expected: [true, false, false, true],
    });
  });
  test('only the walk simulates operations and keeps its navigation', () => {
    const html = render(
      '/tournaments/walk/host/tournaments/autumn-open/entries',
    );
    assert({
      given: 'the same controls inside the sample walk',
      should:
        'answer the preview action there and keep navigation under the walk',
      actual: [
        html.includes('did=Invite'),
        html.includes(
          'href="/tournaments/walk/host/tournaments/autumn-open/entries"',
        ),
        /<button[^>]*disabled/.test(html),
      ],
      expected: [true, true, false],
    });
  });
});
