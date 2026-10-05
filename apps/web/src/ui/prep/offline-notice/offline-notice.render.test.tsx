import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderOfflineNotice } from './offline-notice.render';

setupRitewayBun();

describe('renderOfflineNotice', () => {
  test('online and offline', () => {
    assert({
      given: 'online, then offline',
      should:
        'render nothing, then a status that says changes are not saved, with no promise about reconnecting',
      actual: [
        renderOfflineNotice({ offline: false }),
        /role="status"[^>]*>.*Offline.*Changes here are not saved\./s.test(
          renderToString(renderOfflineNotice({ offline: true })),
        ),
        renderToString(renderOfflineNotice({ offline: true })).includes(
          'reconnect',
        ),
      ],
      expected: [null, true, false],
    });
  });
});
