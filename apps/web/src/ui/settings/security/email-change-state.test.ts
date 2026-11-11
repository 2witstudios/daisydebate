import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { SecurityOutcome } from '../../../features/account/security-client';
import {
  emailChangeFields,
  emailChangeSent,
  emailChangeUnavailable,
  emailChangeUnsent,
  initialEmailChange,
  submitEmailChange,
  type EmailChangeRefusal,
} from './email-change-state';

setupRitewayBun();

const recording = (answer: SecurityOutcome | Error) => {
  const asked: string[] = [];
  const change = async (newEmail: string) => {
    asked.push(newEmail);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, change };
};

describe('submitEmailChange', () => {
  test('starts the change for the trimmed address and echoes it', async () => {
    const { asked, change } = recording({ kind: 'conflict' });
    const form = new FormData();
    form.set('newEmail', ' taken@example.test ');
    assert({
      given: 'a posted email-change form',
      should: 'request the trimmed address and answer with its outcome',
      actual: [await submitEmailChange(change, form), asked],
      expected: [
        {
          kind: 'unsent',
          values: { newEmail: 'taken@example.test' },
          reason: 'conflict',
        },
        ['taken@example.test'],
      ],
    });
  });

  test('answers sent, and only sent, for an accepted change', async () => {
    const form = new FormData();
    form.set('newEmail', 'ada@example.test');
    assert({
      given: 'a change the route accepted',
      should: 'answer the one variant that holds no refusal',
      actual: await submitEmailChange(recording({ kind: 'ok' }).change, form),
      expected: { kind: 'sent', values: { newEmail: 'ada@example.test' } },
    });
  });

  test('reads an untrusted form defensively, and a throw is unavailable', async () => {
    const form = new FormData();
    form.set('newEmail', new Blob(['x']));
    assert({
      given: 'a file for the address, and a change that throws',
      should: 'use an empty address, and answer unavailable, never sent',
      actual: [
        await submitEmailChange(recording({ kind: 'invalid' }).change, form),
        await submitEmailChange(recording(new Error('down')).change, form),
      ],
      expected: [
        { kind: 'unsent', values: { newEmail: '' }, reason: 'invalid' },
        { kind: 'unsent', values: { newEmail: '' }, reason: 'unavailable' },
      ],
    });
  });
});

describe('emailChangeFields', () => {
  test('says where the approval went, or why nothing started', () => {
    assert({
      given: 'no answer yet, an accepted change, and a conflict',
      should:
        'show nothing, then an approval notice, then the refusal as an error, each beside its address',
      actual: [
        emailChangeFields(initialEmailChange),
        emailChangeFields(emailChangeSent('a@b.test')),
        emailChangeFields(emailChangeUnsent('a@b.test', 'conflict')),
      ],
      expected: [
        { newEmail: '', notice: undefined, refusesNewAddress: false },
        {
          newEmail: 'a@b.test',
          notice: {
            tone: 'info',
            title:
              'Check the inbox for the address currently on file to approve this change.',
          },
          refusesNewAddress: false,
        },
        {
          newEmail: 'a@b.test',
          notice: { tone: 'error', title: 'That email is already in use.' },
          refusesNewAddress: false,
        },
      ],
    });
  });

  test('says which address cannot receive email, and only asks for another new one when that helps (ISSUE-113)', () => {
    assert({
      given:
        'a refusal because the new address cannot receive email, then because the address on file cannot',
      should:
        'ask for a different new address and mark the field, then explain the approval cannot be emailed without blaming the new address',
      actual: (['undeliverable', 'current-undeliverable'] as const).map(
        (reason) => emailChangeFields(emailChangeUnsent('a@b.test', reason)),
      ),
      expected: [
        {
          newEmail: 'a@b.test',
          notice: {
            tone: 'error',
            title:
              'We cannot send email to that address. Use a different address.',
          },
          refusesNewAddress: true,
        },
        {
          newEmail: 'a@b.test',
          notice: {
            tone: 'error',
            title:
              'We cannot send email to the address on file, so this change cannot be approved by email.',
          },
          refusesNewAddress: false,
        },
      ],
    });
  });

  test('marks the field only for an undeliverable new address', () => {
    const others: readonly EmailChangeRefusal[] = [
      'stale-session',
      'not-found',
      'conflict',
      'rate-limited',
      'invalid',
      'current-undeliverable',
      'unavailable',
    ];
    assert({
      given: 'no answer, an accepted change and every other refusal',
      should: 'leave the field valid',
      actual: [
        initialEmailChange,
        emailChangeSent('a@b.test'),
        ...others.map((reason) => emailChangeUnsent('a@b.test', reason)),
      ].map((answer) => emailChangeFields(answer).refusesNewAddress),
      expected: [false, false, false, false, false, false, false, false, false],
    });
  });
});

describe('emailChangeUnavailable', () => {
  test('answers unavailable for the posted address', () => {
    const typed = new FormData();
    typed.set('newEmail', ' ada@example.test ');
    const file = new FormData();
    file.set('newEmail', new Blob(['x']));
    assert({
      given: 'a posted form whose change never reached the server',
      should:
        'answer unavailable with the trimmed address, or an empty one for a file',
      actual: [emailChangeUnavailable(typed), emailChangeUnavailable(file)],
      expected: [
        {
          kind: 'unsent',
          values: { newEmail: 'ada@example.test' },
          reason: 'unavailable',
        },
        { kind: 'unsent', values: { newEmail: '' }, reason: 'unavailable' },
      ],
    });
  });
});
