import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { accountsHref, accountsQuery, noticeText } from './view';

setupRitewayBun();

describe('the accounts screen', () => {
  test('its query', () => {
    assert({
      given: 'no query, a full one, and values outside the closed sets',
      should:
        'default to pending, keep a cursor and a known notice, and drop the rest',
      actual: [
        accountsQuery({}),
        accountsQuery({
          access: 'revoked',
          cursor: 'eyJ2IjoxfQ',
          notice: 'conflict',
          mail: 'queued',
        }),
        accountsQuery({
          access: 'everyone',
          cursor: ['a', 'b'],
          notice: '<script>',
          mail: 'sent',
        }),
      ],
      expected: [
        { access: 'pending', cursor: undefined, notice: null, mail: null },
        {
          access: 'revoked',
          cursor: 'eyJ2IjoxfQ',
          notice: 'conflict',
          mail: 'queued',
        },
        { access: 'pending', cursor: undefined, notice: null, mail: null },
      ],
    });
  });

  test('its links', () => {
    assert({
      given: 'a tab, a next page and a notice after a command',
      should: 'encode each into the accounts URL',
      actual: [
        accountsHref({ access: 'approved' }),
        accountsHref({ access: 'pending', cursor: 'a+b/c' }),
        accountsHref({ access: 'pending', notice: 'changed', mail: 'queued' }),
      ],
      expected: [
        '/accounts?access=approved',
        '/accounts?access=pending&cursor=a%2Bb%2Fc',
        '/accounts?access=pending&notice=changed&mail=queued',
      ],
    });
  });

  test('its notices', () => {
    assert({
      given: 'each command outcome',
      should: 'say what happened and the mail status, never claim a failure',
      actual: [
        noticeText('changed', 'queued'),
        noticeText('changed', 'none'),
        noticeText('unchanged', 'none'),
        noticeText('conflict', null),
        noticeText('unknown', null),
        noticeText('denied', null),
      ],
      expected: [
        'Done. Approval email queued.',
        'Done. No email sent.',
        'Already in that state; nothing changed. No email sent.',
        'The account changed since this page loaded. Its current state is shown below; nothing was changed.',
        'The outcome is not known yet. It will be reconciled; do not repeat the action.',
        'Your operator role does not permit this action.',
      ],
    });
  });
});
