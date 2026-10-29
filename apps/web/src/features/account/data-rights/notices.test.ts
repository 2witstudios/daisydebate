import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseDataRightsQuery } from './notices';
import { ERASE_ACCOUNT_QUERY, EXPORT_DATA_QUERY } from './notices-keys';

setupRitewayBun();

test('the settings page reads only the fixed data-rights notice keys', async () => {
  assert({
    given:
      'the fixed keys with their notices, an unknown value, and unrelated query params',
    should:
      'return the notices under their keys and null otherwise, never URL text',
    actual: [
      parseDataRightsQuery({
        [EXPORT_DATA_QUERY]: 'rate-limited',
        [ERASE_ACCOUNT_QUERY]: 'confirm',
      }),
      parseDataRightsQuery({
        [EXPORT_DATA_QUERY]: 'anything-else',
        [ERASE_ACCOUNT_QUERY]: 'nope',
        next: '/elsewhere',
      }),
      parseDataRightsQuery({}),
    ],
    expected: [
      { exportData: 'rate-limited', erase: 'confirm' },
      { exportData: null, erase: null },
      { exportData: null, erase: null },
    ],
  });
});
