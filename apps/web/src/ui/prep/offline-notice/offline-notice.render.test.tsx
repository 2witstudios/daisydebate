import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderOfflineNotice } from './offline-notice.render';

setupRitewayBun();

describe('renderOfflineNotice', () => {
  test('online and offline', () => {
    assert({
      given: 'online, then offline',
      should: 'render nothing, then a status that says nothing is stored yet',
      actual: [
        renderOfflineNotice({ offline: false }),
        /role="status"[^>]*>.*Offline.*stored on this device yet/s.test(
          renderToString(renderOfflineNotice({ offline: true })),
        ),
      ],
      expected: [null, true],
    });
  });
});
