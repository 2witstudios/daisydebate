import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { initialMessageForm } from '../../features/support/message-form';
import { SupportPage } from './support-page';
import { SupportTopicNoteText } from './support-topic-note';

setupRitewayBun();

const messageId = 'k3v9q2w8e7r6t5y4u3i2o1pa';
const page = (replyEmail: string) =>
  renderToString(
    h(SupportPage, {
      messageId,
      replyEmail,
      action: async () => initialMessageForm(messageId, replyEmail),
    }),
  );

describe('SupportPage', () => {
  test('one form with every field, the reply address prefilled', () => {
    const html = page('sam@example.test');
    assert({
      given: 'a signed-in member’s reply address',
      should:
        'render the named form with its topics, fields and the address as the reply value',
      actual: [
        html.includes('<h1'),
        html.includes('aria-label="Contact support"'),
        html.includes('Something isn’t working'),
        html.includes('A safety concern'),
        html.includes('What page or round is this about? (optional)'),
        /id="support-replyEmail"[^>]*value="sam@example.test"/.test(html),
        html.includes(`value="${messageId}"`),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('a visitor starts with an empty reply address', () => {
    assert({
      given: 'no reply address',
      should: 'leave the email field empty',
      actual: /id="support-replyEmail"[^>]*value=""/.test(page('')),
      expected: true,
    });
  });
});

describe('SupportTopicNoteText', () => {
  test('the note follows the topic', () => {
    const note = (topic: Parameters<typeof SupportTopicNoteText>[0]['topic']) =>
      renderToString(h(SupportTopicNoteText, { topic }));
    assert({
      given: 'a problem, a safety concern and an account question',
      should:
        'show nothing, then the Report pointer, then a link to Settings privacy',
      actual: [
        note('problem'),
        note('safety').includes('use Report on it'),
        note('account').includes('href="/settings#privacy"'),
      ],
      expected: ['', true, true],
    });
  });
});
