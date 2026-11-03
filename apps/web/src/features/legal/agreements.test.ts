import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  contentPolicyDocument,
  contentWaiverDocument,
  roundCaptureNotice,
} from './agreements';

setupRitewayBun();

const words = (document: typeof contentWaiverDocument) =>
  [
    document.lede,
    ...document.sections.flatMap((section) => section.paragraphs),
  ].join(' ');

const digest = (value: unknown) =>
  new Bun.CryptoHasher('sha3-256').update(JSON.stringify(value)).digest('hex');

describe('agreements', () => {
  test('a signature names exact words', () => {
    assert({
      given: 'each agreement text and its version',
      should: 'fail here when a text changes without a new version',
      actual: {
        waiver: [
          contentWaiverDocument.version,
          digest(contentWaiverDocument.sections).slice(0, 16),
        ],
        policy: [
          contentPolicyDocument.version,
          digest(contentPolicyDocument.sections).slice(0, 16),
        ],
        ranked: digest(roundCaptureNotice('ranked')).slice(0, 16),
        optedIn: digest(roundCaptureNotice('opted-in')).slice(0, 16),
      },
      expected: {
        waiver: ['draft-2', '280b7de281c63afa'],
        policy: ['draft-2', 'ad02eaf3e87c4119'],
        ranked: 'aa20970794be07a1',
        optedIn: 'f5a46abec416c6cb',
      },
    });
  });

  test('the waiver covers what the owner decided', () => {
    const waiver = words(contentWaiverDocument);
    assert({
      given: 'the waiver wording',
      should:
        'state ownership, clips, likeness, no payment, prep, streaming, per-event terms',
      actual: [
        'Daisy owns what is said and shown',
        'clips and other media',
        'name and likeness',
        'promises no payment',
        'prep material and drives stay yours',
        'no royalty',
        'no exclusive broadcast, no streaming limit and no commercial restriction',
        'stays with its participants',
        'per-event terms',
      ].filter((phrase) => !waiver.includes(phrase)),
      expected: [],
    });
  });

  test('every agreement is plainly a draft, never cleared', () => {
    const all = [contentWaiverDocument, contentPolicyDocument];
    assert({
      given: 'the waiver and the policy',
      should: 'say they are a draft for counsel and never claim clearance',
      actual: all.map(
        (document) =>
          document.lede.includes('draft for counsel') &&
          !/legally cleared|counsel approved|counsel has approved/i.test(
            words(document),
          ),
      ),
      expected: [true, true],
    });
  });

  test('the Round capture notice', () => {
    assert({
      given: 'a ranked Round',
      should: 'say its video stays after account closure',
      actual: roundCaptureNotice('ranked')?.text.includes(
        'stays after you close your account',
      ),
      expected: true,
    });
    assert({
      given: 'an opted-in casual Round',
      should: 'say a recording ends when any participant removes it',
      actual: roundCaptureNotice('opted-in')?.text.includes(
        'ends when any participant removes it',
      ),
      expected: true,
    });
    assert({
      given: 'a Round that captures nothing',
      should: 'have no notice',
      actual: roundCaptureNotice('none'),
      expected: null,
    });
  });
});

test('no agreement restricts help during a ranked round (ADR 0097)', () => {
  const served = [contentWaiverDocument, contentPolicyDocument]
    .map(words)
    .join(' ');
  assert({
    given: 'the waiver and content policy',
    should: 'carry no rule against help or relaying arguments',
    actual: [/assistance/i.test(served), /relaying/i.test(served)],
    expected: [false, false],
  });
});
