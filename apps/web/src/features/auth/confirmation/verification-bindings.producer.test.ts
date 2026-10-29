import { assert, setupRitewayBun, test } from 'riteway/bun';
import { subjectRightsVerificationBindings } from '@daisy/db/privacy';
import {
  EMAILED_LINK_PURPOSES,
  SIGN_IN_STORED_PURPOSE,
  emailedLinkIdentifier,
  generateEmailedLinkToken,
  storedSignInIdentifier,
} from './emailed-link-token';

setupRitewayBun();

/**
 * The erasure bindings and the real link producers, tied together: each
 * purpose binding names the identifier prefix its producer actually stores,
 * derived here from the producer's own functions — never from the binding
 * under test (ISSUE-833 review: the promoted `sign-in` purpose did not
 * match Better Auth's `magic-link:sign-in` stored rows, so erasure left
 * real email-bearing rows behind).
 */

/** The identifier each emailed-link flow's producer really stores. */
const storedIdentifierFor = (purpose: string): string =>
  purpose === SIGN_IN_STORED_PURPOSE
    ? storedSignInIdentifier(generateEmailedLinkToken())
    : emailedLinkIdentifier(
        purpose as (typeof EMAILED_LINK_PURPOSES)[number],
        generateEmailedLinkToken(),
      );

test('every purpose binding names the identifier prefix its producer stores', () => {
  const purposeBindings = subjectRightsVerificationBindings.flatMap(
    (binding) => ('purpose' in binding ? [binding] : []),
  );
  assert({
    given:
      'the erasure bindings beside the real link producers, with a fresh token per flow',
    should:
      'store every producer identifier under its binding prefix, including Better Auth sign-in rows, and cover every emailed-link purpose exactly once',
    actual: [
      purposeBindings.every((binding) =>
        storedIdentifierFor(binding.purpose).startsWith(`${binding.purpose}:`),
      ),
      purposeBindings
        .map((binding) => binding.purpose)
        .sort() as unknown as string[],
      subjectRightsVerificationBindings.filter(
        (binding) => !('purpose' in binding),
      ).length,
    ],
    expected: [
      true,
      [
        'email-change-approve',
        'email-change-verify',
        SIGN_IN_STORED_PURPOSE,
      ].sort(),
      1,
    ],
  });
  assert({
    given: 'the emailed-link purposes the auth feature declares',
    should: 'bind each of them, none missing and none invented',
    actual: EMAILED_LINK_PURPOSES.every((purpose) =>
      purposeBindings.some(
        (binding) =>
          binding.purpose === purpose ||
          // The sign-in link's rows store under Better Auth's prefixed
          // purpose, so the plain flow purpose binds through it.
          (purpose === 'sign-in' && binding.purpose === SIGN_IN_STORED_PURPOSE),
      ),
    ),
    expected: true,
  });
});

test('the email bindings erase only rows whose value names the bound subject key', () => {
  const claims: Record<string, unknown> = {
    'magic-link:sign-in': { email: 'member@example.invalid' },
    'email-change-approve': { userId: 'u'.repeat(24) },
    'email-change-verify': { userId: 'u'.repeat(24) },
  };
  const purposeBindings = subjectRightsVerificationBindings.flatMap(
    (binding) => ('purpose' in binding ? [binding] : []),
  );
  assert({
    given: 'each producer flow claim shape',
    should: 'bind the key in that claim that names the subject',
    actual: purposeBindings.map((binding) => [
      binding.purpose,
      binding.subject,
      Object.hasOwn(
        claims[binding.purpose] as Record<string, unknown>,
        binding.subject,
      ),
    ]),
    expected: [
      ['magic-link:sign-in', 'email', true],
      ['email-change-approve', 'userId', true],
      ['email-change-verify', 'userId', true],
    ],
  });
});
