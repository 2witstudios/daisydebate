import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  isGeneratedName,
  readGeneratedNameWords,
  readPinnedDrizzleKitWords,
} from './migration-names';

setupRitewayBun();

test('reads the word lists drizzle-kit draws migration names from', async () => {
  const words = await readGeneratedNameWords();
  assert({
    given: 'the pinned drizzle-kit',
    should:
      'find both lists and recognise names it generated for this repository',
    actual: [
      words.adjectives.size > 100,
      words.heroes.size > 100,
      isGeneratedName('20261009175809_dark_silver_centurion', words),
      isGeneratedName('20261107105737_exotic_the_santerians', words),
      isGeneratedName('20261121235720_guardian_pending_friend_holds', words),
    ],
    expected: [true, true, true, true, false],
  });
});

test('the committed word lists are the pinned drizzle-kit lists', async () => {
  const [committed, pinned] = [
    await readGeneratedNameWords(),
    await readPinnedDrizzleKitWords(),
  ];
  assert({
    given: 'scripts/migration-name-words.json and the installed drizzle-kit',
    should:
      'hold the same adjectives and heroes; regenerate the copy on upgrade',
    actual: [[...committed.adjectives], [...committed.heroes]],
    expected: [[...pinned.adjectives], [...pinned.heroes]],
  });
});
