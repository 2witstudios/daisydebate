import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SampleButton } from './sample-button';

setupRitewayBun();

describe('SampleButton (ISSUE-314)', () => {
  test('any label', () => {
    const html = renderToString(h(SampleButton, { label: 'Invite entrant' }));
    assert({
      given: 'a one-off control with no backend',
      should: 'be a link carrying its label to the banner',
      actual: [
        html.includes('href="?did=Invite+entrant"'),
        html.includes('disabled=""'),
      ],
      expected: [true, false],
    });
  });

  test('a glyph, or a face of its own', () => {
    const glyph = renderToString(
      h(SampleButton, { label: 'Share', symbol: 'share' }),
    );
    const face = renderToString(
      h(SampleButton, { label: 'Clip this' }, h('span', null, 'Clip')),
    );
    assert({
      given: 'a sample button with a glyph, and one with its own face',
      should:
        'draw the glyph before the label, and show the face while the banner still names the label',
      actual: [
        glyph.includes('<svg') &&
          glyph.indexOf('<svg') < glyph.indexOf('Share<'),
        face.includes('<span>Clip</span>'),
        face.includes('href="?did=Clip+this"'),
      ],
      expected: [true, true, true],
    });
  });
});
