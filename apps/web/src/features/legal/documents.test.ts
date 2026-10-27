import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { placeholderKinds, placeholdersOf } from './documents';
import { privacyDocument } from './privacy';
import { termsDocument } from './terms';
import { PRIVACY_VERSION, TERMS_VERSION } from './versions';

setupRitewayBun();

const ids = (document: { sections: readonly { id: string }[] }) =>
  document.sections.map((section) => section.id);

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

  test('section ids are unique within a document', () => {
    assert({
      given: 'each document',
      should: 'give every section its own anchor',
      actual: [termsDocument, privacyDocument].map(
        (document) => new Set(ids(document)).size === ids(document).length,
      ),
      expected: [true, true],
    });
  });
});

describe('the counsel drafts (WAIT-6.1)', () => {
  test('each says it is a draft, not yet in force', () => {
    assert({
      given: 'the terms and the privacy policy',
      should: 'open by saying they are drafts for counsel',
      actual: [termsDocument, privacyDocument].map(({ lede }) =>
        lede.startsWith('Draft for counsel review, not yet in force.'),
      ),
      expected: [true, true],
    });
  });

  test('every placeholder names who must fill it', () => {
    const marked = new RegExp(`^\\[(${placeholderKinds.join('|')}): .+\\]$`);
    const placeholders = [termsDocument, privacyDocument].flatMap(
      placeholdersOf,
    );
    assert({
      given: 'every bracketed placeholder in both drafts',
      should: 'be an OWNER business fact or a COUNSEL judgment',
      actual: {
        some: placeholders.length > 0,
        unmarked: placeholders.filter((text) => !marked.test(text)),
      },
      expected: { some: true, unmarked: [] },
    });
  });

  test('the privacy draft covers what WAIT-6.1 asks', () => {
    assert({
      given: 'the privacy draft',
      should:
        'name the controller, what is collected and why, AI, visibility, providers and transfers, retention, children, cookies, rights and changes',
      actual: ids(privacyDocument),
      expected: [
        'who-we-are',
        'what-we-collect',
        'why-and-lawful-basis',
        'ai',
        'who-sees-it',
        'processors',
        'retention',
        'children',
        'cookies',
        'your-rights',
        'changes',
      ],
    });
  });

  test('the terms draft covers what WAIT-6.1 asks', () => {
    assert({
      given: 'the terms draft',
      should:
        'cover eligibility, the waiting list, usernames, acceptable use, content, termination, limits, changes and contact',
      actual: ids(termsDocument),
      expected: [
        'agreement',
        'who-can-join',
        'beta-access',
        'usernames',
        'acceptable-use',
        'your-content',
        'results',
        'ending-an-account',
        'limits',
        'changes',
        'contact',
      ],
    });
  });
});
