import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { postedBy } from '../test-support/posted-fields.test-support';
import { initialMessageForm } from '../../features/support/message-form';
import { SupportPage } from './support-page';
import { SupportTopicNoteText } from './support-topic-note';

setupRitewayBun();

const messageId = 'k3v9q2w8e7r6t5y4u3i2o1pa';
const page = (replyEmail: string) =>
  renderAccessible(
    h(SupportPage, {
      messageId,
      replyEmail,
      action: async () => initialMessageForm(messageId, replyEmail),
    }),
  );

describe('SupportPage', () => {
  test('one form with every field, the reply address prefilled', () => {
    const view = page('sam@example.test');
    const form = view.within('form', 'Contact support');
    const posted = postedBy(view, 'Send message');
    assert({
      given: 'a signed-in member’s reply address',
      should:
        'render the named form with its topics, fields and the address as the reply value',
      actual: [
        view.names('heading', { level: 1 }),
        form
          .all('option')
          .map((option) => option.textContent)
          .filter(
            (label) =>
              label === 'Something isn’t working' ||
              label === 'A safety concern',
          ),
        form.has('textbox', 'Message'),
        form.has('textbox', 'What page or round is this about? (optional)'),
        posted.replyEmail,
        posted.messageId,
      ],
      expected: [
        ['Contact support'],
        ['Something isn’t working', 'A safety concern'],
        true,
        true,
        'sam@example.test',
        messageId,
      ],
    });
  });

  test('a visitor starts with an empty reply address', () => {
    assert({
      given: 'no reply address',
      should: 'leave the email field empty',
      actual: postedBy(page(''), 'Send message').replyEmail,
      expected: '',
    });
  });
});

describe('SupportTopicNoteText', () => {
  test('the note follows the topic', () => {
    const note = (topic: Parameters<typeof SupportTopicNoteText>[0]['topic']) =>
      renderAccessible(h(SupportTopicNoteText, { topic }));
    assert({
      given: 'a problem, a safety concern and an account question',
      should:
        'show nothing, then the Report pointer, then a link to Settings privacy',
      actual: [
        note('problem').textContent(),
        note('safety').textContent().includes('use Report on it'),
        note('account').attribute('link', undefined, 'href'),
      ],
      expected: ['', true, '/settings#privacy'],
    });
  });
});
