import { PRIVACY_CONTACT } from './contact';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { privacyDocument, termsDocument } from './documents';
import { PRIVACY_VERSION, TERMS_VERSION } from './versions';

setupRitewayBun();

describe('legal documents', () => {
  test('versions come from the single source', () => {
    assert({
      given: 'the terms and the privacy policy',
      should: 'carry the versions the clickwrap uses',
      actual: [termsDocument.version, privacyDocument.version],
      expected: [TERMS_VERSION, PRIVACY_VERSION],
    });
  });

  test('every section has an id, a heading and text', () => {
    const all = [...termsDocument.sections, ...privacyDocument.sections];
    assert({
      given: 'every section of both documents',
      should: 'name itself and say something',
      actual: all.every(
        (section) =>
          section.id.length > 0 &&
          section.heading.length > 0 &&
          section.paragraphs.length > 0 &&
          section.paragraphs.every((paragraph) => paragraph.length > 0),
      ),
      expected: true,
    });
  });

  test('the terms no longer say a member owns ranked content', () => {
    const terms = termsDocument.sections
      .flatMap((section) => section.paragraphs)
      .join(' ');
    assert({
      given: 'the served terms',
      should: 'separate ranked content, other rounds and prep',
      actual: [
        terms.includes('You own what you write and say'),
        terms.includes('ranked content waiver'),
        terms.includes('your content stays with you'),
        terms.includes('Prep material and drives stay yours'),
      ],
      expected: [false, true, true, true],
    });
  });

  test('the served text matches what the product does', () => {
    const text = (document: typeof termsDocument) =>
      document.sections.flatMap((section) => section.paragraphs).join(' ');
    const terms = text(termsDocument);
    const privacy = text(privacyDocument);
    assert({
      given: 'the served terms and privacy policy',
      should:
        'state 16+, promise no parental agreement or re-acceptance, and name what Watch keeps',
      actual: [
        terms.includes('16 or older'),
        /13 or older|parent|guardian/.test(terms),
        terms.includes('ask you to accept'),
        [
          'Tigris',
          'watch history',
          'audience chat',
          'not video',
          PRIVACY_CONTACT,
        ].filter((word) => !privacy.includes(word)),
      ],
      expected: [true, false, false, []],
    });
  });

  test('section ids are unique within a document', () => {
    assert({
      given: 'each document',
      should: 'give every section its own anchor',
      actual: [termsDocument, privacyDocument].map(
        ({ sections }) =>
          new Set(sections.map((section) => section.id)).size ===
          sections.length,
      ),
      expected: [true, true],
    });
  });

  test('optional analytics is disclosed before activation', () => {
    const analytics =
      privacyDocument.sections
        .find(({ id }) => id === 'analytics')
        ?.paragraphs.join(' ') ?? '';
    assert({
      given: 'the served privacy notice',
      should:
        'explain the processor, all admitted usage facts and excluded content',
      actual: [
        'PostHog',
        'United States',
        'opt in',
        'product areas',
        'Room creation',
        'rematches',
        'consent changes',
        'broadcast',
        'recording',
        'player type',
        'time to start',
        'buffering time',
        'time watched',
        'video height',
        'browser identifier',
        'account ID',
        'username',
        'email',
        'debate content',
        'raw URLs',
        'referrers',
        'connection metadata',
      ].filter((word) => !analytics.includes(word)),
      expected: [],
    });
    assert({
      given: 'a participant deciding whether to consent',
      should:
        'state storage duration, withdrawal and the limits of retrospective deletion',
      actual: [
        '180 days',
        'account erasure',
        '/analytics',
        'Settings',
        'stops future capture',
        'queues deletion',
        'retried',
        'asynchronous',
        'unlinked anonymous events',
        'one-year retention',
        'may retain them longer',
        'no confirmed deadline for physical deletion',
        'Session replay stays disabled',
      ].filter((word) => !analytics.includes(word)),
      expected: [],
    });
  });
});
