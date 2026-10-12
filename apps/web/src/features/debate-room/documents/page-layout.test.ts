import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { scanDocument } from './document-scan';
import { documentExtensions } from './document-schema';
import { normalizeDocumentHtml } from './normalize-html';
import {
  keepPageLayout,
  pageLayoutOf,
  pageLayoutTransaction,
  parsePageColumns,
  portrait,
} from './page-layout';

setupRitewayBun();

const schema = getSchema(documentExtensions);

const paragraph = (text: string) =>
  schema.node('paragraph', null, text === '' ? [] : [schema.text(text)]);

const stateOf = (columns?: number) =>
  EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      ...(columns === undefined
        ? []
        : [schema.node('pageLayout', { columns })]),
      paragraph('AC'),
    ]),
  });

const html = (input: string) => {
  const result = normalizeDocumentHtml(input);
  return result.ok ? result.html.replaceAll('\n', '') : result.reason;
};

describe('parsePageColumns', () => {
  test('column counts', () => {
    assert({
      given: 'stored column values in and out of range, and free text',
      should: 'accept only the offered counts',
      actual: ['2', '6', '1', '7', '3.5', 'x', null].map(parsePageColumns),
      expected: [2, 6, null, null, null, null, null],
    });
  });
});

describe('pageLayoutOf', () => {
  test('a document without a page setting', () => {
    assert({
      given: 'a document that opens with a paragraph',
      should: 'be portrait',
      actual: pageLayoutOf(stateOf().doc),
      expected: portrait,
    });
  });

  test('a landscape document', () => {
    assert({
      given: 'a document that opens with a five-column page setting',
      should: 'be landscape with five columns',
      actual: pageLayoutOf(stateOf(5).doc),
      expected: { orientation: 'landscape', columns: 5 },
    });
  });
});

describe('pageLayoutTransaction', () => {
  const apply = (
    state: EditorState,
    layout: Parameters<typeof pageLayoutTransaction>[1],
  ) => state.apply(pageLayoutTransaction(state, layout));

  test('portrait to landscape', () => {
    const next = apply(stateOf(), { orientation: 'landscape', columns: 3 });
    assert({
      given: 'a portrait document set to three columns',
      should: 'open with the page setting and keep the text',
      actual: [pageLayoutOf(next.doc), next.doc.textContent],
      expected: [{ orientation: 'landscape', columns: 3 }, 'AC'],
    });
  });

  test('changing the column count', () => {
    const next = apply(stateOf(3), { orientation: 'landscape', columns: 5 });
    assert({
      given: 'a three-column document set to five columns',
      should: 'hold one page setting with five columns',
      actual: [pageLayoutOf(next.doc), next.doc.childCount],
      expected: [{ orientation: 'landscape', columns: 5 }, 2],
    });
  });

  test('landscape to portrait', () => {
    const next = apply(stateOf(4), portrait);
    assert({
      given: 'a landscape document set to portrait',
      should: 'drop the page setting and keep the text',
      actual: [pageLayoutOf(next.doc), next.doc.childCount],
      expected: [portrait, 1],
    });
  });
});

describe('keepPageLayout', () => {
  test('an edit that deletes the page setting', () => {
    const before = stateOf(4);
    const deleting = before.tr.delete(0, before.doc.content.size);
    const after = before.apply(deleting);
    const kept = keepPageLayout([deleting], before, after);
    assert({
      given: 'a select-all delete in a four-column document',
      should: 'put the page setting back',
      actual: kept && pageLayoutOf(after.apply(kept).doc),
      expected: { orientation: 'landscape', columns: 4 },
    });
  });

  test('the page control and outside content', () => {
    const before = stateOf(4);
    const control = pageLayoutTransaction(before, portrait);
    const outside = before.tr
      .delete(0, before.doc.content.size)
      .setMeta('preventUpdate', true);
    assert({
      given: 'the page control choosing portrait, and a load from storage',
      should: 'leave each document as written',
      actual: [
        keepPageLayout([control], before, before.apply(control)),
        keepPageLayout([outside], before, before.apply(outside)),
      ],
      expected: [null, null],
    });
  });

  test('a portrait document', () => {
    const before = stateOf();
    const typing = before.tr.insertText('x', 1);
    assert({
      given: 'typing in a portrait document',
      should: 'add nothing',
      actual: keepPageLayout([typing], before, before.apply(typing)),
      expected: null,
    });
  });
});

describe('page setting storage', () => {
  test('the pre-parse scan', () => {
    assert({
      given:
        'a page setting as the editor writes it, and one inside a paragraph',
      should: 'accept the first and refuse the second',
      actual: [
        scanDocument(
          '<div data-page="landscape" data-columns="5"></div><p>a</p>',
        ),
        scanDocument(
          '<p><div data-page="landscape" data-columns="5"></div></p>',
        ),
      ],
      expected: ['ok', 'malformed'],
    });
  });

  test('round trip', () => {
    const stored = html(
      '<div data-page="landscape" data-columns="5"></div><h2>AC</h2><p>A1</p>',
    );
    assert({
      given: 'a five-column document saved',
      should: 'store the page setting first and stay stable when saved again',
      actual: [
        stored.startsWith('<div data-page="landscape" data-columns="5"></div>'),
        html(stored) === stored,
      ],
      expected: [true, true],
    });
  });

  test('settings the schema does not offer', () => {
    assert({
      given:
        'a page setting with a free-text column count, an out-of-range count, a style attribute, and one after the first block',
      should: 'store none of them',
      actual: [
        html('<div data-page="landscape" data-columns="x"></div><p>a</p>'),
        html('<div data-page="landscape" data-columns="9"></div><p>a</p>'),
        html(
          '<div data-page="landscape" data-columns="3" style="columns:9"></div><p>a</p>',
        ),
        html('<p>a</p><div data-page="landscape" data-columns="3"></div>'),
      ],
      expected: [
        '<p>a</p>',
        '<p>a</p>',
        '<div data-page="landscape" data-columns="3"></div><p>a</p>',
        '<p>a</p>',
      ],
    });
  });

  test('a page setting alone', () => {
    assert({
      given: 'a document holding only a page setting',
      should: 'keep it with an empty paragraph after it',
      actual: html('<div data-page="landscape" data-columns="2"></div>'),
      expected: '<div data-page="landscape" data-columns="2"></div><p></p>',
    });
  });
});
