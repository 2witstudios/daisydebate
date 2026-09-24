import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { SecurityOutcome } from '../../../features/account/security-client';
import { emailChangeNotice, submitEmailChange } from './email-change-state';

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
        { newEmail: 'taken@example.test', outcome: 'conflict' },
        ['taken@example.test'],
      ],
    });
  });

  test('reads an untrusted form defensively, and a throw is unavailable', async () => {
    const form = new FormData();
    form.set('newEmail', new Blob(['x']));
    assert({
      given: 'a file for the address, and a change that throws',
      should: 'use an empty address, and answer unavailable, never ok',
      actual: [
        await submitEmailChange(recording({ kind: 'invalid' }).change, form),
        await submitEmailChange(recording(new Error('down')).change, form),
      ],
      expected: [
        { newEmail: '', outcome: 'invalid' },
        { newEmail: '', outcome: 'unavailable' },
      ],
    });
  });
});

describe('emailChangeNotice', () => {
  test('says where the approval went, or why nothing started', () => {
    assert({
      given: 'no answer yet, an accepted change, and a conflict',
      should:
        'show nothing, then an approval notice, then the refusal as an error',
      actual: [
        emailChangeNotice({ newEmail: '' }),
        emailChangeNotice({ newEmail: 'a@b.test', outcome: 'ok' }),
        emailChangeNotice({ newEmail: 'a@b.test', outcome: 'conflict' }),
      ],
      expected: [
        undefined,
        {
          tone: 'info',
          title:
            'Check the inbox for the address currently on file to approve this change.',
        },
        { tone: 'error', title: 'That email is already in use.' },
      ],
    });
  });
});
