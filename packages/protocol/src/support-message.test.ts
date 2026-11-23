import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  supportMessageLimits,
  supportMessageResultSchema,
  supportMessageSchema,
  supportTopics,
} from './support-message';

setupRitewayBun();

const message = {
  v: 1,
  messageId: 'k3v9q2w8e7r6t5y4u3i2o1pa',
  topic: 'problem',
  message: 'The timer froze in my round.\nIt came back after a reload.',
  about: 'Round with @dana on Tuesday',
  replyEmail: 'sam@example.test',
} as const;

const issuePaths = (value: unknown) => {
  const parsed = supportMessageSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.path.join('.'));
};

test('a support message names one of the five topics', () => {
  assert({
    given: 'the topic vocabulary',
    should: 'be problem, question, feedback, account and safety, in that order',
    actual: [...supportTopics],
    expected: ['problem', 'question', 'feedback', 'account', 'safety'],
  });
  assert({
    given: 'a topic outside the vocabulary',
    should: 'refuse the topic',
    actual: issuePaths({ ...message, topic: 'billing' }),
    expected: ['topic'],
  });
});

test('a support message parses to its trimmed fields', () => {
  assert({
    given: 'a message with padded fields',
    should: 'trim each and keep the line breaks inside the message',
    actual: supportMessageSchema.parse({
      ...message,
      message: `  ${message.message}  `,
      about: '  Round with @dana on Tuesday ',
      replyEmail: ' sam@example.test ',
    }),
    expected: message,
  });
  assert({
    given: 'no page or round named',
    should: 'accept an empty about',
    actual: supportMessageSchema.parse({ ...message, about: '' }).about,
    expected: '',
  });
});

test('a support message refuses what the owner email cannot carry', () => {
  assert({
    given: 'an empty message, a malformed email and an unchosen id',
    should: 'name each refused field',
    actual: issuePaths({
      ...message,
      messageId: 'not-an-id',
      message: '   ',
      replyEmail: 'sam at example',
    }),
    expected: ['messageId', 'message', 'replyEmail'],
  });
  assert({
    given: 'a control character in the about line and a message over the limit',
    should: 'refuse both',
    actual: issuePaths({
      ...message,
      about: 'Round\u0007 one',
      message: 'x'.repeat(supportMessageLimits.message + 1),
    }),
    expected: ['message', 'about'],
  });
  assert({
    given: 'a line break in the about line',
    should: 'refuse it: it is one line',
    actual: issuePaths({ ...message, about: 'Round\none' }),
    expected: ['about'],
  });
  assert({
    given: 'a caller-supplied member id',
    should: 'refuse it: who is signed in comes from the session',
    actual: issuePaths({ ...message, memberUserId: 'a'.repeat(24) }),
    expected: [''],
  });
});

test('the route answers only that the message was received', () => {
  assert({
    given: 'the route answer',
    should: 'parse received and nothing else',
    actual: [
      supportMessageResultSchema.safeParse({ received: true }).success,
      supportMessageResultSchema.safeParse({ received: true, id: 'x' }).success,
    ],
    expected: [true, false],
  });
});
