import { assert, setupRitewayBun, test } from 'riteway/bun';
import { EMAILED_LINK_PURPOSES } from '../confirmation/emailed-link-token';
import { provisionalMailCleanup } from './provisional-mail';
import { deriveRecipientSubkey, recipientKey } from './recipient-key';

setupRitewayBun();

test('the provisional mail cleanup names every emailed-link purpose once (review on #474)', () => {
  let reads = 0;
  const cleanup = provisionalMailCleanup(() => {
    reads += 1;
    return 'proof-secret-of-sufficient-length-0123456789';
  });
  const hashes = ['a@example.test', 'b@example.test'].map(
    cleanup.recipientHashOf,
  );
  assert({
    given: "the app's emailed-link purposes and two recipients",
    should:
      'clean sign-in and every email-change purpose, so a renamed or added purpose cannot slip past, and hash with one derived subkey',
    actual: [
      [cleanup.signInPurpose, ...cleanup.emailChangePurposes].sort(),
      hashes,
      reads,
    ],
    expected: [
      [...EMAILED_LINK_PURPOSES].sort(),
      ['a@example.test', 'b@example.test'].map((email) =>
        recipientKey(
          deriveRecipientSubkey('proof-secret-of-sufficient-length-0123456789'),
          email,
        ),
      ),
      1,
    ],
  });
});
