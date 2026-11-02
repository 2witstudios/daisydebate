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
    id: 'bot',
    title: 'Practice with a bot',
    blurb: 'Pick a personality.',
    href: '/coming-soon/train',
    comingSoon: true,
  },
];

describe('PlayChoices', () => {
  test('tags only the ways to play that are not open yet', () => {
    const html = renderToStaticMarkup(<PlayChoices options={options} />);
    const [open, soon] = html.split('</li>');
    assert({
      given: 'an open room form and bot practice that is not launched',
      should:
        'link each where its option says and tag only the bot one Coming soon',
      actual: [
        open?.includes('href="/play/room"'),
        open?.includes('Coming soon'),
        soon?.includes('href="/coming-soon/train"'),
        soon?.includes('Coming soon'),
      ],
      expected: [true, false, true, true],
    });
  });
});
