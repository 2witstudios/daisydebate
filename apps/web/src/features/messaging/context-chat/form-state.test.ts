import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  contextChatAcceptedMessage,
  contextChatChanged,
  contextChatCommand,
  contextChatFields,
  contextChatIdle,
  contextChatRefused,
  contextChatSent,
  contextChatUnacknowledged,
  sameContextChatCommand,
  unacknowledgedContextChatCommand,
  type ContextChatFormState,
} from './form-state';

setupRitewayBun();
const requestId = 'q'.repeat(24);
const nextId = 'n'.repeat(24);
const messageId = 'm'.repeat(24);
const draft = { text: 'A draft', requestId };
const edit = { kind: 'edit', messageId, requestId, text: 'A draft' };

const answers: Readonly<
  Record<ContextChatFormState['kind'], ContextChatFormState>
> = {
  idle: contextChatIdle(requestId, 'A draft'),
  refused: contextChatRefused(draft, 'Refused.'),
  unacknowledged: contextChatUnacknowledged(edit, 'Not confirmed.'),
  sent: contextChatSent(messageId, nextId),
  changed: contextChatChanged(messageId, nextId, 'Saved', 4),
};

test('each chat answer renders as exactly what it is', () => {
  assert({
    given: 'one answer of every kind',
    should:
      'keep a draft only where one is held, a notice only where something was refused or lost, and lock only an unacknowledged command',
    actual: Object.fromEntries(
      Object.entries(answers).map(([kind, answer]) => [
        kind,
        contextChatFields(answer),
      ]),
    ),
    expected: {
      idle: { ...draft, notice: undefined, retrying: false },
      refused: { ...draft, notice: 'Refused.', retrying: false },
      unacknowledged: { ...draft, notice: 'Not confirmed.', retrying: true },
      sent: { text: '', requestId: nextId, notice: undefined, retrying: false },
      changed: {
        text: 'Saved',
        requestId: nextId,
        notice: undefined,
        retrying: false,
      },
    },
  });
  assert({
    given: 'one answer of every kind',
    should: 'name a message only once the server accepted the command',
    actual: Object.values(answers).map(contextChatAcceptedMessage),
    expected: [undefined, undefined, undefined, messageId, messageId],
  });
});

test('an unacknowledged answer carries the whole command its retry repeats', () => {
  const form = new FormData();
  for (const [name, value] of Object.entries(edit)) form.set(name, value);
  form.set('unrelated', 'ignored');
  form.set('reason', new File(['x'], 'not-text'));
  const altered = { ...edit, text: 'Another draft' };
  assert({
    given: 'a posted chat form',
    should: 'read only the text fields that make the command',
    actual: contextChatCommand(form),
    expected: edit,
  });
  assert({
    given: 'the command an unacknowledged answer kept, then a changed one',
    should: 'match the first and no other',
    actual: [
      sameContextChatCommand(edit, contextChatCommand(form)),
      sameContextChatCommand(edit, altered),
      sameContextChatCommand(edit, { ...edit, kind: 'remove' }),
    ],
    expected: [true, false, false],
  });
});

test('only a well-formed unacknowledged answer holds a command back', () => {
  assert({
    given: 'previous answers as a browser could return them',
    should:
      'recover the command from an unacknowledged one and nothing from any other',
    actual: [
      unacknowledgedContextChatCommand(answers.unacknowledged),
      unacknowledgedContextChatCommand(answers.idle),
      unacknowledgedContextChatCommand(answers.refused),
      unacknowledgedContextChatCommand(answers.sent),
      unacknowledgedContextChatCommand(null),
      unacknowledgedContextChatCommand({ kind: 'unacknowledged' }),
      unacknowledgedContextChatCommand({
        kind: 'unacknowledged',
        values: null,
      }),
      unacknowledgedContextChatCommand({
        kind: 'unacknowledged',
        values: { requestId: 'not-an-id', text: 'x' },
      }),
    ],
    expected: [edit, null, null, null, null, null, null, null],
  });
});

test('a command is the same however its line breaks were carried', () => {
  const typed = { ...edit, text: 'one\ntwo\nthree' };
  const posted = new FormData();
  for (const [name, value] of Object.entries(edit)) posted.set(name, value);
  posted.set('text', 'one\r\ntwo\rthree');
  const kept = unacknowledgedContextChatCommand(
    contextChatUnacknowledged(
      { ...edit, text: 'one\r\ntwo\r\nthree' },
      'Not confirmed.',
    ),
  );
  assert({
    given:
      'a multi-line command as the browser held it, as a form posted it, and as an earlier answer kept it',
    should:
      'read each with the same line breaks, and still tell other text apart',
    actual: [
      contextChatCommand(posted),
      kept,
      sameContextChatCommand(typed, contextChatCommand(posted)),
      sameContextChatCommand(typed, { ...typed, text: 'one two three' }),
    ],
    expected: [typed, typed, true, false],
  });
});
