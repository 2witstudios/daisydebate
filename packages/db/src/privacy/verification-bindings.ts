import type { PrivacyVerificationBinding } from './operations';

/**
 * Every `verification` row erasure must reach (ADR 0087): the purposes whose
 * identifiers or JSON values name the subject. One entry per producer flow,
 * each proved in `subject-rights.integration.ts`; the request path passes
 * this whole list, never a subset. The sign-in purpose is Better Auth's
 * stored prefix — its magicLink plugin stores the row under
 * `magic-link:` + the store hash (`sign-in:<sha3>`) — and the apps/web
 * regression `verification-bindings.producer.test.ts` derives exactly this
 * purpose from the real producer, so the two cannot drift again.
 */
export const subjectRightsVerificationBindings: readonly PrivacyVerificationBinding[] =
  [
    // Sign-in links: Better Auth's magicLink plugin stores the row under its
    // own prefixed store hash, with the address in the row's value.
    { purpose: 'magic-link:sign-in', subject: 'email' },
    // The email-change flow's approve and verify links, claims carrying the
    // requesting account's id.
    { purpose: 'email-change-approve', subject: 'userId' },
    { purpose: 'email-change-verify', subject: 'userId' },
    // Passkey enrolment and authentication challenges (Better Auth's passkey
    // plugin): the subject sits at `userData.id` in typed rows.
    {
      jsonTypes: ['registration', 'authentication'],
      subjectPath: ['userData', 'id'],
    },
  ];
