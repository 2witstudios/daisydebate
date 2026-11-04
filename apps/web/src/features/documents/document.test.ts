import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createDocument,
  renameDocument,
  uniqueTitle,
  updateDocumentHtml,
} from './document';

setupRitewayBun();

const now = '2026-10-05T12:00:00.000Z';
const later = '2026-10-05T12:05:00.000Z';

describe('uniqueTitle', () => {
  test('numbering', () => {
    assert({
      given: 'a free title',
      should: 'keep it',
      actual: uniqueTitle('Notes', ['Case']),
      expected: 'Notes',
    });
    assert({
      given: 'a taken title and its second copy',
      should: 'pick the next number',
      actual: uniqueTitle('Notes', ['Notes', 'Notes 2']),
      expected: 'Notes 3',
    });
  });
});

describe('createDocument', () => {
  const input = {
    id: 'doc-1',
    now,
    existingTitles: ['Untitled'],
  };

  test('without a title', () => {
    const created = createDocument(input);
    assert({
      given: 'a second new document',
      should: 'name it "Untitled 2", stamp both times and start it empty',
      actual: [
        created.title,
        created.createdAt,
        created.updatedAt,
        created.html,
      ],
      expected: ['Untitled 2', now, now, '<p></p>'],
    });
  });

  test('with a title', () => {
    assert({
      given: 'an explicit padded title',
      should: 'trim it',
      actual: createDocument({ ...input, title: '  Their case  ' }).title,
      expected: 'Their case',
    });
  });
});

describe('editing', () => {
  const created = createDocument({
    id: 'doc-1',
    now,
    existingTitles: [],
  });

  test('updateDocumentHtml', () => {
    assert({
      given: 'new HTML, then the same HTML again',
      should: 'replace it and bump updatedAt, then leave it unchanged',
      actual: [
        updateDocumentHtml(created, '<p>x</p>', later),
        updateDocumentHtml(created, created.html, later),
      ],
      expected: [{ ...created, html: '<p>x</p>', updatedAt: later }, created],
    });
  });

  test('renameDocument', () => {
    assert({
      given: 'a padded new title',
      should: 'trim it and bump updatedAt',
      actual: renameDocument(created, ' Notes ', later),
      expected: { ...created, title: 'Notes', updatedAt: later },
    });
    assert({
      given: 'a blank title',
      should: 'return the document unchanged',
      actual: renameDocument(created, '   ', later),
      expected: created,
    });
  });
});
