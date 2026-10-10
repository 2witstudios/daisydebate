import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  parseGroupManagementForm,
  groupManagementUnavailable,
} from './group-management-form';
setupRitewayBun();
test('group management form binds operation/channel and preserves refused target and retry', async () => {
  const form = new FormData();
  form.set('requestId', 'r'.repeat(24));
  form.set('memberUsername', 'Member_1');
  assert({
    given: 'a remove intent and a bound channel',
    should:
      'produce only target username intent and retain refused retry fields',
    actual: [
      parseGroupManagementForm('remove', 'c'.repeat(24), form),
      groupManagementUnavailable(form).memberUsername,
    ],
    expected: [
      {
        version: 1,
        channelId: 'c'.repeat(24),
        requestId: 'r'.repeat(24),
        operation: 'remove',
        memberUsername: 'Member_1',
      },
      'Member_1',
    ],
  });
  form.append('memberUsername', 'other');
  await assertRejects({
    given: 'duplicate target field',
    should: 'refuse ambiguous native intent',
    actual: () =>
      Promise.resolve(
        parseGroupManagementForm('transfer', 'c'.repeat(24), form),
      ),
    code: 'VALIDATION',
  });
});

test('native invitation reuses only the bound channel and proposed username intent', () => {
  const form = new FormData();
  form.set('requestId', 'r'.repeat(24));
  form.set('memberUsername', 'Member_1');
  assert({
    given: 'invite selected on the group membership form',
    should:
      'submit an explicit proposal without management permission or grant fields',
    actual: parseGroupManagementForm('invite', 'c'.repeat(24), form),
    expected: {
      version: 1,
      channelId: 'c'.repeat(24),
      requestId: 'r'.repeat(24),
      invitedUsernames: ['Member_1'],
    },
  });
});
