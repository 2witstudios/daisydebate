import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  breakLines,
  insertAtAnchor,
  isHtmlDocument,
  linesOf,
  numberedLines,
  replaceLines,
  sameDocumentHtml,
} from './document-lines';

setupRitewayBun();

const editorHtml =
  '<h1>Flow</h1><ul><li><p>FW <strong>harm</strong></p></li></ul><p></p>';

describe('breakLines', () => {
  test('editor output', () => {
    assert({
      given: 'HTML from the editor, all on one line',
      should:
        'put each block tag on its own line and keep inline marks with their text',
      actual: linesOf(editorHtml),
      expected: [
        '<h1>',
        'Flow',
        '</h1>',
        '<ul>',
        '<li>',
        '<p>',
        'FW <strong>harm</strong>',
        '</p>',
        '</li>',
        '</ul>',
        '<p>',
        '</p>',
      ],
    });
  });

  test('idempotent', () => {
    const once = breakLines(editorHtml);
    assert({
      given: 'text that is already broken',
      should: 'leave it as it is',
      actual: breakLines(once),
      expected: once,
    });
  });

  test('not a document', () => {
    assert({
      given: 'text that does not open with a block tag',
      should: 'be left untouched, even when it contains tags',
      actual: breakLines('note: use <p> for paragraphs'),
      expected: 'note: use <p> for paragraphs',
    });
  });
});

describe('isHtmlDocument', () => {
  test('anchored', () => {
    assert({
      given: 'a document and text with a tag in its middle',
      should: 'recognise only the one that opens with a block tag',
      actual: [isHtmlDocument('<p>x</p>'), isHtmlDocument('{"a":"<p>"}')],
      expected: [true, false],
    });
  });
});

describe('numberedLines', () => {
  test('numbering', () => {
    assert({
      given: 'a short document',
      should: 'number lines from 1 the way the AI reads them',
      actual: numberedLines('<p>a</p>'),
      expected: '1→<p>\n2→a\n3→</p>',
    });
  });
});

describe('replaceLines', () => {
  const html = '<h1>Flow</h1><p>old</p>';

  test('a range', () => {
    const edit = replaceLines(html, { start: 5, content: 'new' });
    assert({
      given: 'line 5 (the paragraph text) replaced',
      should: 'store the edit and report the count measured on what is stored',
      actual: edit,
      expected: {
        ok: true,
        html: '<h1>\nFlow\n</h1>\n<p>\nnew\n</p>',
        totalLines: 6,
      },
    });
  });

  test('inserted markup', () => {
    const edit = replaceLines(html, {
      start: 4,
      end: 6,
      content: '<ul><li><p>a</p></li></ul>',
    });
    assert({
      given: 'a paragraph replaced by a one-line list',
      should: 'break the new markup like the rest of the document',
      actual: edit.ok ? linesOf(edit.html).length : -1,
      expected: 10,
    });
  });

  test('deleting', () => {
    assert({
      given: 'empty content',
      should: 'delete the range',
      actual: replaceLines(html, { start: 4, end: 6, content: '' }),
      expected: { ok: true, html: '<h1>\nFlow\n</h1>', totalLines: 3 },
    });
  });

  test('stale', () => {
    assert({
      given: 'an edit addressed to a different line count',
      should: 'refuse it as stale and report the current count',
      actual: replaceLines(html, {
        start: 5,
        content: 'x',
        expectedTotalLines: 9,
      }),
      expected: { ok: false, reason: 'stale', totalLines: 6 },
    });
  });

  test('out of range', () => {
    assert({
      given: 'a range past the end',
      should: 'refuse it',
      actual: replaceLines(html, { start: 5, end: 7, content: 'x' }),
      expected: { ok: false, reason: 'range', totalLines: 6 },
    });
  });
});

describe('insertAtAnchor', () => {
  test('after a heading', () => {
    const edit = insertAtAnchor('<h2>NC</h2><ul><li><p>a</p></li></ul>', {
      anchor: '</h2>',
      content: '<p>note</p>',
      position: 'after',
    });
    assert({
      given: 'content inserted after the line holding the anchor',
      should: 'place it there, broken into lines',
      actual: edit.ok ? linesOf(edit.html).slice(3, 6) : [],
      expected: ['<p>', 'note', '</p>'],
    });
  });

  test('missing anchor', () => {
    assert({
      given: 'an anchor that is not in the document',
      should: 'refuse the edit',
      actual: insertAtAnchor('<p>a</p>', {
        anchor: 'zzz',
        content: 'x',
        position: 'after',
      }).ok,
      expected: false,
    });
  });
});

describe('sameDocumentHtml', () => {
  test('stored and editor forms', () => {
    assert({
      given: 'the stored line-broken form and the editor’s one-line form',
      should: 'be the same document',
      actual: sameDocumentHtml(breakLines(editorHtml), editorHtml),
      expected: true,
    });
  });

  test('a changed line', () => {
    assert({
      given: 'a document whose text changed',
      should: 'not be the same document',
      actual: sameDocumentHtml('<p>a</p>', '<p>ab</p>'),
      expected: false,
    });
  });

  test('a newline inside text', () => {
    assert({
      given: 'a newline between words rather than beside a tag',
      should: 'count as a difference',
      actual: sameDocumentHtml('<p>a\nb</p>', '<p>ab</p>'),
      expected: false,
    });
  });
});

describe('breakLines and attributes', () => {
  test('a quoted attribute holding tag-like text', () => {
    const html = '<ol type="a>b</p>c"><li><p>x</p></li></ol>';
    assert({
      given: 'an attribute value containing ">" and "</p>"',
      should: 'keep the whole tag on one line',
      actual: linesOf(html)[0],
      expected: '<ol type="a>b</p>c">',
    });
  });
});

describe('insertAtAnchor staleness', () => {
  test('a stale line count', () => {
    assert({
      given: 'an anchor edit addressed to a different line count',
      should: 'refuse it as stale and report the current count',
      actual: insertAtAnchor('<h2>NC</h2><p>a</p>', {
        anchor: '</h2>',
        content: '<p>b</p>',
        position: 'after',
        expectedTotalLines: 9,
      }),
      expected: { ok: false, reason: 'stale', totalLines: 6 },
    });
  });

  test('a current line count', () => {
    assert({
      given: 'an anchor edit addressed to the current line count',
      should: 'apply it',
      actual: insertAtAnchor('<h2>NC</h2><p>a</p>', {
        anchor: '</h2>',
        content: '<p>b</p>',
        position: 'after',
        expectedTotalLines: 6,
      }).ok,
      expected: true,
    });
  });
});
