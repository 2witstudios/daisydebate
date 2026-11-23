import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import {
  privacyDocument,
  termsDocument,
} from '../../../features/legal/documents';
import { LegalPage } from './legal-page';

setupRitewayBun();

describe('LegalPage', () => {
  test('the terms', () => {
    const view = renderAccessible(h(LegalPage, { document: termsDocument }));
    const whoCanJoin =
      termsDocument.sections.find((section) => section.id === 'who-can-join')
        ?.heading ?? '';
    assert({
      given: 'the terms document',
      should:
        'show one h1 with the version, a contents link and a section for every heading',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        view.textContent().includes(`Version ${termsDocument.version}.`),
        view
          .within('navigation', 'Contents')
          .attribute('link', whoCanJoin, 'href'),
        view.count('region'),
        view.attribute('region', whoCanJoin, 'id'),
      ],
      expected: [
        1,
        true,
        '#who-can-join',
        termsDocument.sections.length,
        'who-can-join',
      ],
    });
  });

  test('the privacy policy', () => {
    const view = renderAccessible(h(LegalPage, { document: privacyDocument }));
    assert({
      given: 'the privacy document',
      should: 'name itself and list its sections in a contents list',
      actual: [
        view.textContent().includes('Privacy policy'),
        view
          .within('navigation', 'Contents')
          .all('link')
          .filter((link) => link.getAttribute('href')?.startsWith('#')).length,
      ],
      expected: [true, privacyDocument.sections.length],
    });
  });

  test('an extra control closes the page', () => {
    const view = renderAccessible(
      h(LegalPage, {
        document: privacyDocument,
        extra: h('p', null, 'Change your analytics choices'),
      }),
    );
    const lastSection = view.all('region').at(-1);
    const control = view
      .all('paragraph')
      .find((p) => p.textContent === 'Change your analytics choices');
    assert({
      given: 'a document and the control it points at',
      should: 'render the control after the last section',
      actual:
        control !== undefined &&
        lastSection !== undefined &&
        Boolean(
          lastSection.compareDocumentPosition(control) &
          lastSection.DOCUMENT_POSITION_FOLLOWING,
        ) &&
        !lastSection.contains(control),
      expected: true,
    });
  });
});
