import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SourceLegend, SourceText } from './source-text';

setupRitewayBun();

describe('SourceText', () => {
  test('each layer has its own mark', () => {
    const html = renderToString(
      h(SourceText, {
        segments: [
          { kind: 'context', text: 'a' },
          { kind: 'read', text: 'b' },
          { kind: 'keep', text: 'c' },
        ],
      }),
    );
    assert({
      given: 'context, read and keep segments',
      should: 'mark read, underline keep, and leave context plain',
      actual: [
        /<mark[^>]*>b<\/mark>/.test(html),
        /<u[^>]*>c<\/u>/.test(html),
        html.includes('<span>a</span>'),
      ],
      expected: [true, true, true],
    });
  });

  test('legend', () => {
    assert({
      given: 'the legend',
      should: 'explain all three layers',
      actual: ['Read aloud', 'Kept, not read', 'Plain text is context'].map(
        (text) => renderToString(h(SourceLegend)).includes(text),
      ),
      expected: [true, true, true],
    });
  });
});
