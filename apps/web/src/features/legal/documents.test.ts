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
});
