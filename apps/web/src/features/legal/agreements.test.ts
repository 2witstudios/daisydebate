import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  agreementWords,
  contentPolicyDocument,
  contentWaiverDocument,
  roundCaptureNotice,
} from './agreements';

setupRitewayBun();

const words = agreementWords;

/** A legal draft's text as served: no placeholders, no link markup. */
const servedFromDraft = (markdown: string) =>
  markdown
    .slice(markdown.indexOf('\n## ') + 1)
    .replace(/ ?\[COUNSEL:[^\]]*\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
const servedSections = (document: typeof contentWaiverDocument) =>
  document.sections
    .map(
      (section) =>
        `## ${section.heading}\n\n${section.paragraphs.join('\n\n')}`,
    )
    .join('\n\n');
const draft = (file: string) =>
  Bun.file(
    new URL(`../../../../../docs/legal/${file}`, import.meta.url),
  ).text();

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
          digest(agreementWords(contentWaiverDocument)).slice(0, 16),
        ],
        policy: [
          contentPolicyDocument.version,
          digest(agreementWords(contentPolicyDocument)).slice(0, 16),
        ],
        ranked: digest(roundCaptureNotice('ranked')).slice(0, 16),
        optedIn: digest(roundCaptureNotice('opted-in')).slice(0, 16),
      },
      expected: {
        waiver: ['draft-4', 'a5009809ca79179f'],
        policy: ['draft-3', '9995635043e09c3e'],
        ranked: '9984848ef00acbef',
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

  test('every agreement says it has not been reviewed, and implies no gate', () => {
    const all = [contentWaiverDocument, contentPolicyDocument];
    assert({
      given: 'the waiver and the policy',
      should:
        'say counsel has not reviewed them, and never claim clearance or approval',
      actual: all.map(
        (document) =>
          document.lede.includes('has not been reviewed by counsel') &&
          !/legally cleared|counsel approve|counsel has approved/i.test(
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
    should: 'carry no rule against help or relaying arguments, in any heading',
    actual: [/assistance/i, /relaying/i, /\bhelp\b/i].map((rule) =>
      rule.test(served),
    ),
    expected: [false, false, false],
  });
});

test('every section of an agreement says something', () => {
  assert({
    given: 'the waiver and content policy',
    should: 'serve no heading with nothing under it',
    actual: [contentWaiverDocument, contentPolicyDocument]
      .flatMap((document) => document.sections)
      .filter((section) => section.paragraphs.length === 0)
      .map((section) => section.heading),
    expected: [],
  });
});

test('the content policy steers streamers without stopping anyone', () => {
  const policy = words(contentPolicyDocument);
  assert({
    given: 'the content policy',
    should:
      'recommend Stream this Round, allow self-streaming on the ladder and let a tournament ban it',
    actual: [
      'The easiest way to stream a ranked round is Stream this Round',
      'On the ranked ladder you may also stream with your own tools or by screen capture',
      'which may also ban screen capture and self-streaming',
    ].filter((phrase) => !policy.includes(phrase)),
    expected: [],
  });
});

test('the served text is the source draft, without its placeholders', async () => {
  assert({
    given: 'each draft in docs/legal and what the app serves',
    should: 'say the same words',
    actual: [
      servedFromDraft(await draft('ranked-content-waiver.md')),
      servedFromDraft(await draft('ranked-content-policy.md')),
    ],
    expected: [
      servedSections(contentWaiverDocument),
      servedSections(contentPolicyDocument),
    ],
  });
});

test('a signature records the words a member read', () => {
  const recorded = agreementWords(contentWaiverDocument);
  assert({
    given: 'the waiver',
    should: 'hold its title, lede, every heading and every paragraph',
    actual: [
      contentWaiverDocument.title,
      contentWaiverDocument.lede,
      ...contentWaiverDocument.sections.flatMap((section) => [
        section.heading,
        ...section.paragraphs,
      ]),
    ].filter((part) => !recorded.includes(part)),
    expected: [],
  });
});
