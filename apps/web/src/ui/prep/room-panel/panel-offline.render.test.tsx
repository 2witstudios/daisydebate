import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderPanelOffline } from './panel-offline.render';

setupRitewayBun();

describe('renderPanelOffline', () => {
  test('online and offline', () => {
    const offline = renderPanelOffline({
      offline: true,
      since: '12:04',
      retry: <a href="/x">Try again</a>,
    });
    assert({
      given: 'online, then offline',
      should:
        'show nothing, then a status naming when the page was loaded and offering a retry',
      actual: [
        renderPanelOffline({ offline: false, since: '12:04', retry: null }),
        renderToString(offline).includes('Prep cannot reach the server'),
        renderToString(offline).includes('Read only, as of 12:04'),
        renderToString(offline).includes('Try again'),
      ],
      expected: [null, true, true, true],
    });
  });
});
