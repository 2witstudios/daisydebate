import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  blankMessage,
  honeypotField,
  initialMessageForm,
  messageFields,
  messageIncomplete,
  messageRateLimited,
  messageUnacknowledged,
  messageValuesOf,
  supportMessageOf,
} from './message-form';

setupRitewayBun();

const messageId = 'k3v9q2w8e7r6t5y4u3i2o1pa';

const filled = {
  ...blankMessage(messageId, 'sam@example.test'),
  topic: 'question',
  message: '  How do strikes work in Freestyle?  ',
  about: ' The draw page ',
};

test('supportMessageOf', () => {
  assert({
    given: 'a topic, a message and a reply address, with a page named',
    should: 'accept the message with its text trimmed',
    actual: supportMessageOf(filled),
    expected: {
      kind: 'accepted',
      message: {
        v: 1,
        messageId,
        topic: 'question',
        message: 'How do strikes work in Freestyle?',
        about: 'The draw page',
        replyEmail: 'sam@example.test',
      },
    },
  });

  assert({
    given: 'no page or round named',
    should: 'accept it: that field is optional',
    actual: supportMessageOf({ ...filled, about: '   ' }).kind,
    expected: 'accepted',
  });

  assert({
    given: 'the blank form for a visitor',
    should: 'ask for the message and a reply address, and nothing optional',
    actual: supportMessageOf(blankMessage(messageId, '')),
    expected: {
      kind: 'incomplete',
      errors: {
        message: 'Write your message, up to 4,000 characters.',
        replyEmail: 'Enter an email address we can reply to.',
      },
    },
  });

  assert({
    given: 'a topic outside the list and a line break in the about line',
    should: 'refuse each with its own message',
    actual: supportMessageOf({
      ...filled,
      topic: 'billing',
      about: 'Round\r\nBcc: x@y.z',
    }),
    expected: {
      kind: 'incomplete',
      errors: {
        topic: 'Choose what this is about.',
        about: 'Keep this to one line of 200 characters.',
      },
    },
  });

  assert({
    given: 'a form whose message id was tampered with',
    should: 'ask for a reload',
    actual: supportMessageOf({ ...filled, messageId: 'not-an-id' }),
    expected: {
      kind: 'incomplete',
      errors: {
        messageId: 'This form has expired. Reload the page and send it again.',
      },
    },
  });

  assert({
    given: 'the hidden trap filled, even on an otherwise valid form',
    should: 'read as trapped',
    actual: supportMessageOf({ ...filled, [honeypotField]: 'https://spam' }),
    expected: { kind: 'trapped' },
  });
});

test('messageValuesOf', () => {
  assert({
    given: 'posted values with extra and missing keys',
    should: 'keep exactly the form fields, missing ones empty',
    actual: messageValuesOf({
      message: 'Hi',
      [honeypotField]: 'y',
      memberUserId: 'z',
    }),
    expected: {
      messageId: '',
      topic: '',
      message: 'Hi',
      about: '',
      replyEmail: '',
    },
  });
});

test('messageFields', () => {
  assert({
    given: 'the form as a signed-in member first sees it',
    should: 'prefill their reply address and lead with the first topic',
    actual: messageFields(
      initialMessageForm(messageId, 'sam@example.test') as Parameters<
        typeof messageFields
      >[0],
    ).values,
    expected: {
      messageId,
      topic: 'problem',
      message: '',
      about: '',
      replyEmail: 'sam@example.test',
    },
  });

  assert({
    given: 'an incomplete answer',
    should: 'render the typed values with each field message',
    actual: messageFields(
      messageIncomplete(filled, { replyEmail: 'Enter an email' }),
    ),
    expected: {
      values: filled,
      errors: { replyEmail: 'Enter an email' },
      notice: undefined,
    },
  });

  assert({
    given: 'a refusal for too many messages',
    should: 'keep the values and say to try later',
    actual: messageFields(messageRateLimited(filled)),
    expected: {
      values: filled,
      errors: {},
      notice: 'Too many messages right now. Try again later.',
    },
  });

  assert({
    given: 'a lost answer',
    should: 'keep the values and say it is safe to send again',
    actual: messageFields(messageUnacknowledged(filled)).notice,
    expected:
      'We may not have received your message. Send it again; it will only arrive once.',
  });
});
