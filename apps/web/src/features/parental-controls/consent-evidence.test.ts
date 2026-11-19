import { createHash } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { servedNotice } from '../legal/guardian-notices';
import { recordConsent } from './consent-evidence';

setupRitewayBun();

const at = '2026-11-19T12:00:00.000Z';
const parentNotice = servedNotice('parental-consent');
const childNotice = servedNotice('child-confirmation');

test('a parent’s consent', () => {
  assert({
    given: 'a parent agreeing to the notice in force by creating an account',
    should: 'record who, when, the version, its words’ digest and the method',
    actual: recordConsent({
      id: 'e'.repeat(24),
      personUserId: 'p'.repeat(24),
      method: 'created-account',
      notice: parentNotice,
      shownVersion: parentNotice.version,
      at,
    }),
    expected: {
      kind: 'recorded',
      evidence: {
        id: 'e'.repeat(24),
        personUserId: 'p'.repeat(24),
        role: 'guardian',
        method: 'created-account',
        noticeKind: 'parental-consent',
        noticeVersion: 'draft-1',
        noticeDigest: createHash('sha3-256')
          .update(parentNotice.words)
          .digest('hex'),
        recordedAt: at,
      },
    },
  });
  assert({
    given: 'a parent shown an older version',
    should: 'refuse rather than record agreement to words they did not see',
    actual: recordConsent({
      id: 'e'.repeat(24),
      personUserId: 'p'.repeat(24),
      method: 'requested-link',
      notice: parentNotice,
      shownVersion: 'draft-0',
      at,
    }),
    expected: { kind: 'refused', refusal: 'notice-changed' },
  });
});

test('a child’s confirmation', () => {
  assert({
    given: 'a child confirming under the confirmation notice',
    should: 'record it as the child’s evidence',
    actual: recordConsent({
      id: 'f'.repeat(24),
      personUserId: 'c'.repeat(24),
      method: 'confirmed-link',
      notice: childNotice,
      shownVersion: childNotice.version,
      at,
    }).kind,
    expected: 'recorded',
  });
  assert({
    given: 'a method paired with the other role’s notice',
    should: 'refuse it: each role agrees to its own notice',
    actual: [
      recordConsent({
        id: 'f'.repeat(24),
        personUserId: 'c'.repeat(24),
        method: 'confirmed-link',
        notice: parentNotice,
        shownVersion: parentNotice.version,
        at,
      }).kind,
      recordConsent({
        id: 'f'.repeat(24),
        personUserId: 'p'.repeat(24),
        method: 'requested-link',
        notice: childNotice,
        shownVersion: childNotice.version,
        at,
      }).kind,
    ],
    expected: ['refused', 'refused'],
  });
});
