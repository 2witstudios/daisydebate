import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import type { OpenDocument } from '../../features/documents/open-documents';
import { DocumentPane } from './document-pane';

setupRitewayBun();

const render = (open: OpenDocument, id: string) =>
  renderAccessible(
    <DocumentPane
      opened={[open]}
      tabs={{ open: [id], active: id }}
      pages={{}}
      dispatch={() => {}}
      empty={<p>nothing open</p>}
    />,
  );

describe('DocumentPane', () => {
  test('loading is a quiet placeholder, with no input', () => {
    const view = render({ kind: 'loading', id: 'a', title: 'Plan' }, 'a');
    assert({
      given: 'a document still loading',
      should: 'say it is opening and offer nothing to type into',
      actual: [
        view.text('status'),
        view.count('textbox', undefined, { hidden: true }),
      ],
      expected: ['Opening Plan', 0],
    });
  });

  test('failed says so and offers a retry, never an empty editor', () => {
    const view = render({ kind: 'failed', id: 'a', title: 'Plan' }, 'a');
    const alert = view.within('alert');
    assert({
      given: 'a document that did not open',
      should: 'say so, offer to try again, and offer nothing to type into',
      actual: [
        alert.textContent().includes('Plan did not open.'),
        alert.has('button', 'Try again'),
        view.count('textbox', undefined, { hidden: true }),
      ],
      expected: [true, true, 0],
    });
  });
});
