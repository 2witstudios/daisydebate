import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Modal } from './modal';

setupRitewayBun();

describe('Modal', () => {
  test('a labelled dialog with its title, words and actions', () => {
    const html = renderToString(
      h(Modal, {
        label: 'Paused',
        title: 'Paused',
        actions: 'ACT',
        children: 'Words',
      }),
    );
    assert({
      given: 'a modal',
      should: 'be a modal dialog with the label, heading, words and actions',
      actual: [
        html.includes('role="dialog"'),
        html.includes('aria-modal="true"'),
        html.includes('aria-label="Paused"'),
        html.includes('<h2'),
        html.includes('Words'),
        html.includes('ACT'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
});
