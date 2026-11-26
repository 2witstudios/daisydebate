import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { pageColourClasses } from '../ui/test-support/stage-palette';
import { openLinks } from '../features/marketing/links.test-support';
import { AboutPage } from '../ui/about/about-page/about-page';

setupRitewayBun();

/**
 * The seasons band sits on the forest stage in both schemes; a page-palette
 * colour there draws forest on forest in light (ADR 0045). The palette is a
 * design-system visual contract read from the class lists, with no
 * accessible equivalent.
 */
describe('AboutPage markup', () => {
  test('the seasons band keeps to stage colours', () => {
    const html = renderMarkup(h(AboutPage, { audience: openLinks }));
    const band = html.slice(
      html.indexOf('bg-surface-stage'),
      html.indexOf('</section>', html.indexOf('bg-surface-stage')),
    );
    assert({
      given: 'the forest seasons band',
      should: 'draw no page-palette colour on the stage',
      actual: pageColourClasses(band),
      expected: [],
    });
  });
});
