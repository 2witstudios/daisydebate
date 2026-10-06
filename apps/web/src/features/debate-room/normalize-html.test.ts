import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { linesOf } from './document-lines';
import { MAX_DEPTH, MAX_ELEMENTS } from './document-scan';
import { DOCUMENT_MAX_BYTES, normalizeDocumentHtml } from './normalize-html';

setupRitewayBun();

const html = (input: string) => {
  const result = normalizeDocumentHtml(input);
  return result.ok ? result.html : result.reason;
};

describe('normalizeDocumentHtml', () => {
  test('unsafe attributes on allowed tags', () => {
    assert({
      given: 'a paragraph carrying an event handler and a style attribute',
      should: 'keep the paragraph and drop what the schema does not know',
      actual: html('<p onclick="steal()" style="color:red">hi</p>'),
      expected: '<p>\nhi\n</p>',
    });
  });

  test('elements the editor never writes', () => {
    assert({
      given: 'a script, an image with a handler and an iframe',
      should: 'refuse the document as malformed rather than store any of it',
      actual: [
        html('<p>hi<script>alert(1)</script></p>'),
        html('<p>hi<img src=x onerror=alert(1)></p>'),
        html('<p>hi</p><iframe src="https://evil.example"></iframe>'),
      ],
      expected: ['malformed', 'malformed', 'malformed'],
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

describe('normalizeDocumentHtml bounds', () => {
  const nested = (depth: number) =>
    `<p>${'<strong>'.repeat(depth)}x${'</strong>'.repeat(depth)}</p>`;

  test('deep nesting', () => {
    assert({
      given: '7,500 nested blockquotes, under the size cap',
      should: 'refuse it as too complex instead of overflowing the stack',
      actual: html(
        `${'<blockquote>'.repeat(7_500)}x${'</blockquote>'.repeat(7_500)}`,
      ),
      expected: 'too-complex',
    });
  });

  test('nesting within the bound', () => {
    assert({
      given: 'marks nested to the depth limit',
      should: 'normalize it',
      actual: html(nested(MAX_DEPTH - 1)).startsWith('<p>'),
      expected: true,
    });
  });

  test('stray closing tags', () => {
    assert({
      given:
        'blockquotes opened 2,999 times, each followed by a stray closing tag',
      should: 'refuse the unmatched closes as malformed',
      actual: html(`<p>a</p>${'<blockquote></x>'.repeat(2_999)}`),
      expected: 'malformed',
    });
  });

  test('nesting the parser would build differently', () => {
    assert({
      given:
        'blocks opened inside a paragraph, and a close that does not match the innermost element',
      should: 'refuse each as malformed instead of storing hidden depth',
      actual: [
        html(`<p>a</p>${'<p><ul><li></p>'.repeat(999)}`),
        html(`<p>a</p>${'<p><blockquote></p>'.repeat(1_499)}`),
        html('<p><strong>a</p></strong>'),
      ],
      expected: ['malformed', 'malformed', 'malformed'],
    });
  });

  test('editor output passes the strict scan', () => {
    const editor =
      '<h1>Flow</h1><ul><li><p><strong>FW</strong> harm <span data-debate-mark="dropped">C3</span></p></li></ul>' +
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Q</p></div></li></ul>' +
      '<blockquote><p>quote</p></blockquote><ol type="a"><li><p>one<br>two</p></li></ol><hr><p></p>';
    assert({
      given: 'HTML shaped as the editor writes it',
      should: 'normalize, and stay stable when normalized again',
      actual: ((once: string) => [
        once.startsWith('<h1>'),
        html(once) === once,
      ])(html(editor)),
      expected: [true, true],
    });
  });

  test('tags hidden in comments and raw text', () => {
    const hiding = (wrap: (close: string) => string) =>
      `<p>a</p>${`<blockquote>${wrap('</blockquote>')}`.repeat(2_900)}`;
    assert({
      given:
        'closing tags inside comments, CDATA and script, style and textarea text, each 2,900 times',
      should:
        'refuse each as malformed: the scan reads only markup the editor writes',
      actual: [
        html(hiding((close) => `<!--${close}-->`)),
        html(hiding((close) => `<![CDATA[${close}]]>`)),
        html(hiding((close) => `<script>${close}</script>`)),
        html(hiding((close) => `<STYLE>${close}</style>`)),
        html(hiding((close) => `<textarea>${close}</textarea>`)),
      ],
      expected: [
        'malformed',
        'malformed',
        'malformed',
        'malformed',
        'malformed',
      ],
    });
  });

  test('comments and raw text in ordinary documents', () => {
    assert({
      given:
        'a document with a doctype, a comment, a style element, or an unterminated comment',
      should: 'refuse it rather than guess how the parser reads it',
      actual: [
        html('<!DOCTYPE html><p>a</p>'),
        html('<p>a<!-- note --></p>'),
        html('<p>a</p><style>p{}</style>'),
        html('<p>a</p><!-- <p>b</p>'),
      ],
      expected: ['not-html', 'malformed', 'malformed', 'malformed'],
    });
  });

  test('markup formed by removing a comment', () => {
    assert({
      given: 'a script tag split by a comment',
      should: 'refuse it as malformed',
      actual: html('<p>a</p><scr<!---->ipt></blockquote></script>'),
      expected: 'malformed',
    });
  });

  test('non-void tags written self-closing', () => {
    assert({
      given: 'blocks written with "/>", which the parser opens anyway',
      should:
        'refuse each as malformed: "/>" is only honoured on void elements',
      actual: [
        html(`<p>a</p>${'<blockquote/>'.repeat(2_999)}`),
        html(`<p>a</p>${'<ul/><li/><p/>'.repeat(999)}`),
        html(`<p>a</p>${'<blockquote/><p>x</p>'.repeat(1_499)}`),
      ],
      expected: ['malformed', 'malformed', 'malformed'],
    });
  });

  test('too many elements', () => {
    assert({
      given: 'a flat document with more elements than the limit',
      should: 'refuse it as too complex',
      actual: html('<p>x</p>'.repeat(MAX_ELEMENTS + 1)),
      expected: 'too-complex',
    });
  });

  test('the refused shapes are refused before any parse', () => {
    const refused = [
      `<p>a</p>${'<p><ul><li></p>'.repeat(999)}`,
      `<p>a</p>${'<p><blockquote></p>'.repeat(1_499)}`,
      `<p>a</p>${'<blockquote></x>'.repeat(2_999)}`,
      `${'<blockquote>'.repeat(7_500)}x${'</blockquote>'.repeat(7_500)}`,
      `<p>a</p>${'<blockquote><!--</blockquote>-->'.repeat(2_900)}`,
      `<p>a</p>${'<blockquote><![CDATA[</blockquote>]]>'.repeat(2_900)}`,
      `<p>a</p>${'<blockquote><script></blockquote></script>'.repeat(2_900)}`,
      `<p>a</p>${'<blockquote/>'.repeat(2_999)}`,
      `<p>a</p>${'<ul/><li/><p/>'.repeat(999)}`,
      `<p>a</p>${'<blockquote/><p>x</p>'.repeat(1_499)}`,
    ];
    // Only the linear scan refuses as malformed or too complex; a refusal
    // from the parse would be "not-html". So none of these reached it.
    const reasons = refused.map((input) => {
      const result = normalizeDocumentHtml(input);
      return result.ok ? 'stored' : result.reason;
    });
    assert({
      given:
        'implied-close, stray-close, deep-nesting, hidden-close and self-closing attacks',
      should: 'each be refused by the scan, before any parse',
      actual: reasons.every((r) => r === 'malformed' || r === 'too-complex'),
      expected: true,
    });
  });

  test('the costliest accepted shapes stay cheap', () => {
    const shapes = {
      flat: `<p>${'word '.repeat(10)}</p>`.repeat(MAX_ELEMENTS),
      nested:
        `${'<blockquote>'.repeat(MAX_DEPTH - 1)}<p>x</p>${'</blockquote>'.repeat(MAX_DEPTH - 1)}`.repeat(
          Math.floor(MAX_ELEMENTS / MAX_DEPTH),
        ),
      marks: `<p>${'<strong>a</strong><em>b</em>'.repeat(1_400)}</p>`,
      list: `<ul>${'<li><p>x</p></li>'.repeat(1_499)}</ul>`,
    };
    const timed = Object.entries(shapes).map(([name, input]) => {
      const started = performance.now();
      const result = normalizeDocumentHtml(input);
      // The scan caps the work (3,000 elements, depth 32); measured cost is
      // 24-38 ms. The ceiling only catches a return to super-linear work,
      // never machine load.
      return [name, result.ok && performance.now() - started < 2_000] as const;
    });
    assert({
      given:
        'flat, deeply nested, mark-heavy and list-heavy documents at the bounds',
      should: 'each normalize well inside a generous 2 s ceiling',
      actual: timed,
      expected: Object.keys(shapes).map((name) => [name, true] as const),
    });
  });
});

describe('normalizeDocumentHtml list types', () => {
  test('free-text and known list types', () => {
    assert({
      given:
        'an ordered list with a free-text type, one whose type holds ">", and one with type "a"',
      should: 'drop the free text, refuse the ">", and keep the known type',
      actual: [
        html('<ol type="x y"><li><p>1</p></li></ol>').startsWith('<ol>'),
        html('<ol type="x>y"><li><p>1</p></li></ol>'),
        html('<ol type="a"><li><p>1</p></li></ol>').includes('type="a"'),
      ],
      expected: [true, 'malformed', true],
    });
  });
});
