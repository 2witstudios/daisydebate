import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  agreementWords,
  contentPolicyDocument,
  contentWaiverDocument,
  contentWaiverOf,
  casualCaptureNotice,
  youthContentWaiverDocument,
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
        youthWaiver: [
          youthContentWaiverDocument.version,
          digest(agreementWords(youthContentWaiverDocument)).slice(0, 16),
        ],
        policy: [
          contentPolicyDocument.version,
          digest(agreementWords(contentPolicyDocument)).slice(0, 16),
        ],
        casualCapture: digest(casualCaptureNotice).slice(0, 16),
      },
      expected: {
        waiver: ['draft-5', '6f5e0f74680debb0'],
        youthWaiver: ['youth-draft-1', 'c83c18684671a808'],
        policy: ['draft-5', 'ee41ec4f8f6d84d0'],
        casualCapture: 'f5a46abec416c6cb',
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

  test('the Youth waiver licenses nothing (decision 89, ADR 0161)', () => {
    const waiver = words(youthContentWaiverDocument);
    assert({
      given: 'the Youth waiver wording, and each lobby’s waiver',
      should:
        'say ranked is public, watched and kept; grant no ownership, clip, likeness or stream-and-earn; and be the one a Youth Room asks for',
      actual: {
        says: [
          'Ranked rounds are always public',
          'replay them on Daisy',
          'stay on Daisy',
          'taken down',
          'gives Daisy no ownership',
          'media release',
        ].filter((phrase) => !waiver.includes(phrase)),
        grants: [
          'Daisy owns',
          'Daisy may edit',
          'anyone else may stream',
          'You may earn',
          'promote ranked play',
        ].filter((phrase) => waiver.includes(phrase)),
        lobbies: [contentWaiverOf('adult'), contentWaiverOf('16-17')].map(
          (document) => document.version,
        ),
      },
      expected: {
        says: [],
        grants: [],
        lobbies: ['draft-5', 'youth-draft-1'],
      },
    });
  });

  test('every agreement says it has not been reviewed, and implies no gate', () => {
    const all = [
      contentWaiverDocument,
      youthContentWaiverDocument,
      contentPolicyDocument,
    ];
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
      expected: [true, true, true],
    });
  });

  test('the casual capture notice', () => {
    assert({
      given: 'a casual Round its host opted into capture',
      should: 'say a recording ends when any participant removes it',
      actual: casualCaptureNotice.text.includes(
        'ends when any participant removes it',
      ),
      expected: true,
    });
  });
});

test('no agreement restricts help during a ranked round (ADR 0097)', () => {
  const served = [
    contentWaiverDocument,
    youthContentWaiverDocument,
    contentPolicyDocument,
  ]
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

test('the adult waiver and public policy both require a separate youth release', () => {
  assert({
    given: 'a ranked Round with a youth debater in an adult lobby',
    should: 'require a separate media release for every youth debater',
    actual: [contentWaiverDocument, contentPolicyDocument].map(
      (document) =>
        /separate media release covering every youth debater/.test(
          words(document),
        ) && /including in an adult lobby/.test(words(document)),
    ),
    expected: [true, true],
  });
});

test('the served text is the source draft, without its placeholders', async () => {
  assert({
    given: 'each draft in docs/legal and what the app serves',
    should: 'say the same words',
    actual: [
      servedFromDraft(await draft('ranked-content-waiver.md')),
      servedFromDraft(await draft('youth-ranked-content-waiver.md')),
      servedFromDraft(await draft('ranked-content-policy.md')),
    ],
    expected: [
      servedSections(contentWaiverDocument),
      servedSections(youthContentWaiverDocument),
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
