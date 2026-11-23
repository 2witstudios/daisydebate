import { assert, setupRitewayBun, test } from 'riteway/bun';
import { supportTopics } from '@daisy/protocol/support-message';
import { supportTopicNote } from './topic-note';

setupRitewayBun();

test('the note a chosen topic shows', () => {
  assert({
    given: 'a safety concern',
    should:
      'point to Report on the person, message or round, and allow sending',
    actual: supportTopicNote('safety'),
    expected: {
      kind: 'report',
      text: 'To report a person, message or round, use Report on it. It goes straight to moderation. You can still send this.',
    },
  });
  assert({
    given: 'an account or privacy topic',
    should: 'point to Settings for a copy or deletion of their data',
    actual: supportTopicNote('account'),
    expected: {
      kind: 'settings',
      text: 'You can download or delete your data yourself in',
      link: { label: 'Settings', href: '/settings#privacy' },
    },
  });
  assert({
    given: 'every other topic',
    should: 'show no note',
    actual: supportTopics
      .filter((topic) => topic !== 'safety' && topic !== 'account')
      .map(supportTopicNote),
    expected: [{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }],
  });
});
