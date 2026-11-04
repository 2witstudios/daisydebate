import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderToString } from 'react-dom/server';
import type { OpenDocument } from '../../features/documents/open-documents';
import { DocumentPane } from './document-pane';

setupRitewayBun();

const render = (open: OpenDocument, id: string) =>
  renderToString(
    <DocumentPane
      opened={[open]}
      tabs={{ open: [id], active: id }}
      pages={{}}
      dispatch={() => {}}
      empty={<p>nothing open</p>}
    />,
  ).replaceAll('<!-- -->', '');

describe('DocumentPane', () => {
  test('loading is a quiet placeholder, with no input', () => {
    const html = render({ kind: 'loading', id: 'a', title: 'Plan' }, 'a');
    assert({
      given: 'a document still loading',
      should: 'say it is opening and offer nothing to type into',
      actual: [
        html.includes('Opening Plan'),
        html.includes('contenteditable'),
        html.includes('room-doc'),
        html.includes('role="textbox"'),
      ],
      expected: [true, false, false, false],
    });
  });

  test('failed says so and offers a retry, never an empty editor', () => {
    const html = render({ kind: 'failed', id: 'a', title: 'Plan' }, 'a');
    assert({
      given: 'a document that did not open',
      should: 'say so, offer to try again, and offer nothing to type into',
      actual: [
        html.includes('Plan did not open'),
        html.includes('Try again'),
        html.includes('contenteditable'),
        html.includes('room-doc'),
      ],
      expected: [true, true, false, false],
    });
  });
});
