import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { applyProposal, blockText } from './document-edits';

setupRitewayBun();

const plan =
  '<h1>NR</h1><ul><li><p><strong>0:30</strong> overview</p></li>' +
  '<li><p><strong>0:30</strong> N3 <span data-debate-mark="new">New</span></p></li>' +
  '<li><p>voters</p></li></ul>';

describe('blockText', () => {
  test('markup, entities and line breaks', () => {
    assert({
      given: 'a stored block with tags, entities and storage newlines',
      should: 'read as its visible text with whitespace collapsed',
      actual: blockText(
        '<li>\n<p>\n<strong>0:30</strong>  a &amp; b&#39;s<em>!</em>\n</p>\n</li>',
      ),
      expected: "0:30 a & b's!",
    });
  });
});

describe('applyProposal', () => {
  test('a removed list item', () => {
    assert({
      given: 'a proposal removing one bullet and adding two',
      should: 'put the two new bullets where the removed one was',
      actual: applyProposal(plan, {
        removed: ['0:30 N3 New'],
        added: ['0:15 N3', '0:15 <N2>'],
      }),
      expected:
        '<h1>NR</h1><ul><li><p><strong>0:30</strong> overview</p></li>' +
        '<li><p>0:15 N3</p></li><li><p>0:15 &lt;N2&gt;</p></li>' +
        '<li><p>voters</p></li></ul>',
    });
  });

  test('stored line breaks', () => {
    assert({
      given: 'the same plan in its line-broken stored form',
      should: 'still find the removed bullet by its text',
      actual: applyProposal(plan.replaceAll('>', '>\n'), {
        removed: ['voters'],
        added: ['vote neg'],
      }).includes('voters'),
      expected: false,
    });
  });

  test('a removed paragraph and a second removed line', () => {
    assert({
      given: 'a proposal removing a paragraph and a later bullet',
      should: 'replace the paragraph with paragraphs and delete the bullet',
      actual: applyProposal('<p>old</p><ul><li><p>gone</p></li></ul>', {
        removed: ['old', 'gone'],
        added: ['new'],
      }),
      expected: '<p>new</p><ul></ul>',
    });
  });

  test('nothing to remove', () => {
    assert({
      given: 'a proposal with no removed lines',
      should: 'append the added lines as one bullet list',
      actual: applyProposal('<p>a</p>', { removed: [], added: ['<b>x</b>'] }),
      expected: '<p>a</p><ul><li><p>&lt;b&gt;x&lt;/b&gt;</p></li></ul>',
    });
  });

  test('a removed line the document no longer has', () => {
    assert({
      given: 'removed text that matches no block',
      should: 'append the added lines',
      actual: applyProposal('<p>a</p>', { removed: ['zzz'], added: ['x'] }),
      expected: '<p>a</p><ul><li><p>x</p></li></ul>',
    });
  });

  test('nothing at all', () => {
    assert({
      given: 'an empty proposal',
      should: 'return the document unchanged',
      actual: applyProposal('<p>a</p>', { removed: [], added: [] }),
      expected: '<p>a</p>',
    });
  });
});
