import { playOptionsFor } from '../../../features/play/options';
import { ladderCopyInView } from '../../test-support/ladder-copy.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
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
    const view = renderAccessible(<PlayChoices options={options} />);
    assert({
      given: 'an open room form and bot practice',
      should: 'link each where its option says',
      actual: view.all('link').map((link) => link.getAttribute('href')),
      expected: ['/play/room', '/train/bots'],
    });
  });
});

test('a choice coming soon is shown, not linked', () => {
  const view = renderAccessible(
    <PlayChoices options={playOptionsFor(false)} />,
  );
  assert({
    given: 'a viewer without the bot-debates release',
    should: 'list bot practice as coming soon and link every other choice',
    actual: [
      view.textContent().includes('Coming soon.'),
      view.all('link').some((link) => link.getAttribute('href') === '/train'),
      view.all('link').length,
    ],
    expected: [true, false, playOptionsFor(false).length - 1],
  });
});

test('the Play options name no ladder, style or division (owner copy)', () => {
  assert({
    given: 'every way to play the Lobby offers',
    should: 'use generic words only',
    actual: ladderCopyInView(
      renderAccessible(<PlayChoices options={playOptionsFor(true)} />),
    ),
    expected: null,
  });
});
