import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { PlayOption } from '../../../features/play/options';
import { PlayChoices } from './play-choices';

setupRitewayBun();

const options: readonly PlayOption[] = [
  {
    id: 'room',
    title: 'Open a room',
    blurb: 'Your topic and settings.',
    href: '/play/room',
    comingSoon: false,
  },
  {
    id: 'ranked',
    title: 'Ranked match',
    blurb: 'Matched near your rating. Rated.',
    href: '/coming-soon/ranked',
    comingSoon: true,
  },
];

describe('PlayChoices', () => {
  test('tags only the ways to play that are not open yet', () => {
    const html = renderToStaticMarkup(<PlayChoices options={options} />);
    const [open, soon] = html.split('</li>');
    assert({
      given: 'an open room form and a ranked match that is not launched',
      should:
        'link each where its option says and tag only the ranked one Coming soon',
      actual: [
        open?.includes('href="/play/room"'),
        open?.includes('Coming soon'),
        soon?.includes('href="/coming-soon/ranked"'),
        soon?.includes('Coming soon'),
      ],
      expected: [true, false, true, true],
    });
  });
});
