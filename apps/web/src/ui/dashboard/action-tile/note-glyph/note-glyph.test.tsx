import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from '../../../../features/destinations/destinations';
import { renderAccessible } from '../../../../test-support/rendered/accessible';
import { NoteGlyph } from './note-glyph';

setupRitewayBun();

describe('NoteGlyph', () => {
  test('is hidden from assistive technology', () => {
    assert({
      given: 'every destination, inside the link it decorates',
      should: 'be decorative, so the link keeps its own name',
      actual: destinationSlugs.filter((slug) => {
        const link = renderAccessible(
          <a href="/note">
            <NoteGlyph
              destination={slug}
              seasonGlance={{ number: 2, line: '12 days left' }}
            />
            Note
          </a>,
        );
        const glyph = link.within('link', 'Note');
        // Rendered (its spans exist when hidden ones are counted), yet absent from the tree.
        return !(
          glyph.count('generic') === 0 &&
          glyph.count('generic', undefined, { hidden: true }) > 0
        );
      }),
      expected: [],
    });
  });
});
