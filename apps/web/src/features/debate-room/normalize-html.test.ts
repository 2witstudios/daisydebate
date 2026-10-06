import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { linesOf } from './document-lines';
import { DOCUMENT_MAX_BYTES, normalizeDocumentHtml } from './normalize-html';

setupRitewayBun();

const html = (input: string) => {
  const result = normalizeDocumentHtml(input);
  return result.ok ? result.html : result.reason;
};

describe('normalizeDocumentHtml', () => {
  test('unsafe markup', () => {
    const out = html(
      '<p onclick="steal()" style="color:red">hi<script>alert(1)</script><img src=x onerror=alert(1)></p><iframe src="https://evil.example"></iframe>',
    );
    assert({
      given:
        'HTML carrying a script, a handler, a style attribute, an image and an iframe',
      should: 'keep only what the document schema knows',
      actual: out,
      expected: '<p>\nhi\n</p>',
    });
  });

  test('debate marks and checklists', () => {
    const out = html(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Q <span data-debate-mark="dropped">C3</span></p></li></ul>',
    );
    assert({
      given: 'a checked task holding a debate mark',
      should: 'keep the mark kind and the checked state',
      actual: [
        out.includes('data-debate-mark="dropped"'),
        out.includes('data-checked="true"'),
      ],
      expected: [true, true],
    });
  });

  test('stable', () => {
    const once = html(
      '<h1>Flow</h1><ul><li><p>FW <strong>harm</strong></p></li></ul>',
    );
    assert({
      given: 'a document normalized twice',
      should: 'come out the same the second time',
      actual: html(once),
      expected: once,
    });
  });

  test('line-broken for storage', () => {
    assert({
      given: 'editor output on one line',
      should: 'be stored with each block tag on its own line',
      actual: linesOf(html('<h2>NC</h2><p>a</p>')),
      expected: ['<h2>', 'NC', '</h2>', '<p>', 'a', '</p>'],
    });
  });

  test('refusals', () => {
    assert({
      given: 'plain text, and a body past the size limit',
      should: 'refuse each with its reason',
      actual: [
        html('just text'),
        html(`<p>${'x'.repeat(DOCUMENT_MAX_BYTES)}</p>`),
      ],
      expected: ['not-html', 'too-large'],
    });
  });

  test('text across lines', () => {
    assert({
      given: 'paragraph text split across two lines',
      should: 'keep the words apart',
      actual: html('<p>first\nsecond</p>').includes('first second'),
      expected: true,
    });
  });

  test('empty', () => {
    assert({
      given: 'an empty body',
      should: 'store one empty paragraph',
      actual: html('  '),
      expected: '<p>\n</p>',
    });
  });
});
