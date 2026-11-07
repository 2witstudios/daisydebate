import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  canClaimPreapproval,
  preapprovalEmailSchema,
} from './beta-preapproval';
import { normalizeEmail } from './email';
setupRitewayBun();
describe('beta email preapproval policy', () => {
  test('email identity preserves provider-specific addressing', () => {
    assert({
      given: 'mixed case and surrounding spaces with dots and a plus tag',
      should: 'match only the trimmed case-insensitive identity',
      actual: normalizeEmail('  A.B+beta@Example.Test  '),
      expected: 'a.b+beta@example.test',
    });
    assert({
      given: 'a malformed email',
      should: 'refuse saving it',
      actual: preapprovalEmailSchema.safeParse('bad').success,
      expected: false,
    });
  });
  test('claims require verified eligible pending identity', () => {
    const eligible = {
      verified: true,
      erased: false,
      restricted: false,
      state: 'pending',
      ageBand: 'adult',
    };
    const cases = [
      eligible,
      { ...eligible, verified: false },
      { ...eligible, erased: true },
      { ...eligible, restricted: true },
      { ...eligible, state: 'revoked' },
      { ...eligible, state: 'approved' },
      { ...eligible, state: null },
      { ...eligible, ageBand: null },
      { ...eligible, ageBand: '13-15' },
      { ...eligible, ageBand: '16-17' },
    ];
    assert({
      given:
        'pending, unverified, erased, moderated, revoked, approved and age-ineligible identities',
      should: 'admit only verified unrestricted pending accounts aged 16+',
      actual: cases.map(canClaimPreapproval),
      expected: [
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
      ],
    });
  });
});
