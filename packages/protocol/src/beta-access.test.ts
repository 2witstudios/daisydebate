import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideBetaAccessChange } from './beta-access';

setupRitewayBun();

describe('decideBetaAccessChange (ADR 0075)', () => {
  test('approves and revokes against the revision the operator saw', () => {
    assert({
      given: 'a pending account approved, then an approved account revoked',
      should: 'change state and bump the revision',
      actual: [
        decideBetaAccessChange({
          current: { state: 'pending', revision: 1 },
          desired: 'approved',
          expectedRevision: 1,
          ageAdmitted: true,
        }),
        decideBetaAccessChange({
          current: { state: 'approved', revision: 2 },
          desired: 'revoked',
          expectedRevision: 2,
          ageAdmitted: true,
        }),
      ],
      expected: [
        { kind: 'changed', from: 'pending', to: 'approved', revision: 2 },
        { kind: 'changed', from: 'approved', to: 'revoked', revision: 3 },
      ],
    });
  });

  test('a stale form, a missing account and a no-op change nothing', () => {
    assert({
      given:
        'an approval against an old revision, an account with no beta row, and approving the approved',
      should: 'refuse the first two and report the third unchanged',
      actual: [
        decideBetaAccessChange({
          current: { state: 'revoked', revision: 3 },
          desired: 'approved',
          expectedRevision: 2,
          ageAdmitted: true,
        }),
        decideBetaAccessChange({
          current: null,
          desired: 'approved',
          expectedRevision: 1,
          ageAdmitted: true,
        }),
        decideBetaAccessChange({
          current: { state: 'approved', revision: 2 },
          desired: 'approved',
          expectedRevision: 2,
          ageAdmitted: true,
        }),
      ],
      expected: [
        { kind: 'refused', reason: 'stale' },
        { kind: 'refused', reason: 'not-found' },
        { kind: 'unchanged', state: 'approved', revision: 2 },
      ],
    });
  });

  test('an account without a durable 16+ age record is never approved (ISSUE-664)', () => {
    assert({
      given: 'approving and revoking a pending account with no age record',
      should: 'refuse the approval and still allow the revocation',
      actual: [
        decideBetaAccessChange({
          current: { state: 'pending', revision: 1 },
          desired: 'approved',
          expectedRevision: 1,
          ageAdmitted: false,
        }),
        decideBetaAccessChange({
          current: { state: 'pending', revision: 1 },
          desired: 'revoked',
          expectedRevision: 1,
          ageAdmitted: false,
        }).kind,
      ],
      expected: [{ kind: 'refused', reason: 'age-required' }, 'changed'],
    });
  });
});
