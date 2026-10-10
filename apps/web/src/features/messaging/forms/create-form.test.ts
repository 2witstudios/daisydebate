import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { parseCreationForm, creationFormUnavailable } from './create-form';
setupRitewayBun();
test('native creation forms preserve username intents, drafts and request binding', async () => {
  const form = new FormData();
  form.set('requestId', 'r'.repeat(24));
  form.set('recipients', 'Peer_One, peer-two');
  form.set('title', 'Private group');
  assert({
    given: 'native group fields',
    should: 'propose names without inventing actor membership',
    actual: parseCreationForm('private_group', form),
    expected: {
      version: 1,
      requestId: 'r'.repeat(24),
      title: 'Private group',
      invitedUsernames: ['Peer_One', 'peer-two'],
    },
  });
  form.set('recipients', 'Peer_One');
  form.delete('title');
  form.set('introduction', 'Exact introduction');
  assert({
    given: 'native DM fields',
    should: 'preserve exact introduction and request identity',
    actual: parseCreationForm('dm', form),
    expected: {
      version: 1,
      requestId: 'r'.repeat(24),
      recipientUsername: 'Peer_One',
      introduction: 'Exact introduction',
    },
  });
  assert({
    given: 'an unavailable submission',
    should: 'retain the entered names and body with its idempotency key',
    actual: creationFormUnavailable(form).recipients,
    expected: 'Peer_One',
  });
  form.append('recipients', 'another');
  await assertRejects({
    given: 'ambiguous recipient fields',
    should: 'refuse before discovery',
    actual: async () => parseCreationForm('dm', form),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'an untrusted bound mode',
    should: 'refuse unsupported creation',
    actual: async () => parseCreationForm('other', form),
    code: 'VALIDATION',
  });
});
