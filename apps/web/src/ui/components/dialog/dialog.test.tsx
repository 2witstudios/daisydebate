import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { Dialog } from './dialog';
import { StatusRegion } from '../status-region/status-region';

setupRitewayBun();

test('dialog shells preserve the platform element and accessibility name', () => {
  const label = { 'aria-labelledby': 'title' };
  assert({
    given: 'a native modal and a feature-managed overlay',
    should: 'preserve each shell and its label',
    actual: [
      renderToStaticMarkup(createElement(Dialog, label, 'Choose a format')),
      renderToStaticMarkup(
        createElement(Dialog, { ...label, as: 'section', 'aria-modal': true }),
      ),
    ],
    expected: [
      '<dialog aria-labelledby="title">Choose a format</dialog>',
      '<section aria-labelledby="title" aria-modal="true" role="dialog"></section>',
    ],
  });
});

test('announcements preserve the live region priority and the host element', () => {
  assert({
    given: 'an inline status and a paragraph alert',
    should: 'retain the layout and announce at the intended priority',
    actual: [
      renderToStaticMarkup(
        <StatusRegion as="span" role="status">
          Saved
        </StatusRegion>,
      ),
      renderToStaticMarkup(
        <StatusRegion as="p" role="alert">
          Try again
        </StatusRegion>,
      ),
    ],
    expected: [
      '<span role="status">Saved</span>',
      '<p role="alert">Try again</p>',
    ],
  });
});
