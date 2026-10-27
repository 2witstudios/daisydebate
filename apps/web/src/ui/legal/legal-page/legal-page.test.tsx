import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  privacyDocument,
  termsDocument,
} from '../../../features/legal/documents';
import { LegalPage } from './legal-page';

setupRitewayBun();

describe('LegalPage', () => {
  test('the terms', () => {
    const html = renderToString(h(LegalPage, { document: termsDocument }));
    assert({
      given: 'the terms document',
      should:
        'show one h1 with the version, a contents link and a section for every heading',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes(`Version ${termsDocument.version}.`),
        html.includes('href="#who-can-join"'),
        html.match(/<section /g)?.length,
        html.includes('id="who-can-join-heading"'),
      ],
      expected: [1, true, true, termsDocument.sections.length, true],
    });
  });

  test('the privacy policy', () => {
    const html = renderToString(h(LegalPage, { document: privacyDocument }));
    assert({
      given: 'the privacy document',
      should: 'name itself and list its sections in a contents list',
      actual: [
        html.includes('Privacy policy'),
        (html.match(/href="#/g) ?? []).length,
      ],
      expected: [true, privacyDocument.sections.length],
    });
  });
});
