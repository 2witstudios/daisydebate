import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import {
  destinationSlugs,
  type DestinationSlug,
} from '../features/destinations/destinations';
import { Icon, type IconName } from '../ui/components/icon/icon';
import { NoteGlyph } from '../ui/dashboard/action-tile/note-glyph/note-glyph';

setupRitewayBun();

/**
 * The note glyph is decorative SVG (aria-hidden): the icon paths it draws at
 * rest and the SVG text of the Seasons reveal have no accessible
 * equivalent, so they are read from the markup.
 */
const restingIcons: Readonly<Record<DestinationSlug, IconName>> = {
  lobby: 'swords',
  watch: 'eye',
  judge: 'gavel',
  tournaments: 'trophy',
  seasons: 'calendar',
  leaderboard: 'chart',
  train: 'brain',
  prep: 'book',
};

const pathsOf = (html: string): readonly string[] =>
  [...html.matchAll(/ d="([^"]+)"/g)].map((match) => match[1] ?? '');

const glyph = (destination: DestinationSlug) =>
  renderMarkup(<NoteGlyph destination={destination} />);

describe('NoteGlyph markup', () => {
  test('draws the shared icon at rest for every destination', () => {
    assert({
      given: 'each destination and its shared icon',
      should: 'carry every path of the icon, so rest looks the same',
      actual: destinationSlugs.filter((slug) => {
        const paths = pathsOf(glyph(slug));
        return pathsOf(renderMarkup(<Icon name={restingIcons[slug]} />)).some(
          (d) => !paths.includes(d),
        );
      }),
      expected: [],
    });
  });

  test('reveals the number and time only with a glance', () => {
    const withGlance = renderMarkup(
      <NoteGlyph
        destination="seasons"
        seasonGlance={{ number: 2, line: '12 days left' }}
      />,
    );
    const without = glyph('seasons');
    assert({
      given: 'the Seasons note with a glance and without one',
      should: 'carry the number and line only with one',
      actual: [
        withGlance.includes('>2</text>'),
        withGlance.includes('12 days left'),
        without.includes('<text'),
        without.includes('note-glyph-reveal'),
      ],
      expected: [true, true, false, false],
    });
  });
});
