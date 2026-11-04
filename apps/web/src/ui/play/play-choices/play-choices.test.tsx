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
  },
  {
    id: 'bot',
    title: 'Practice with a bot',
    blurb: 'Pick a personality.',
    href: '/train/bots',
  },
];

describe('PlayChoices', () => {
  test('links each way to play where its option says', () => {
    const html = renderToStaticMarkup(<PlayChoices options={options} />);
    assert({
      given: 'an open room form and bot practice',
      should: 'link each where its option says',
      actual: [
        html.includes('href="/play/room"'),
        html.includes('href="/train/bots"'),
      ],
      expected: [true, true],
    });
  });
});
