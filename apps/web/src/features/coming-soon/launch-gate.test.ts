import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs, type DestinationSlug } from './destinations';
import { launched } from './launch';
import { redirectUnlessLaunched } from './launch-gate';

setupRitewayBun();

const config = (open: boolean) =>
  Object.fromEntries(destinationSlugs.map((slug) => [slug, open])) as Record<
    DestinationSlug,
    boolean
  >;

/** Where the gate sends the request, or null when it lets it through. */
const redirectedTo = (run: () => void): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return String((error as { digest?: unknown }).digest).split(';')[2] ?? null;
  }
};

describe('redirectUnlessLaunched', () => {
  test('a closed destination answers with its explainer', () => {
    assert({
      given: 'a destination that is not launched',
      should: 'redirect to its explainer',
      actual: redirectedTo(() =>
        redirectUnlessLaunched('watch', config(false)),
      ),
      expected: '/coming-soon/watch',
    });
  });

  test('a launched destination passes', () => {
    assert({
      given: 'a launched destination',
      should: 'let the page render',
      actual: redirectedTo(() => redirectUnlessLaunched('watch', config(true))),
      expected: null,
    });
  });

  test('Watch stays closed until its real sources exist', () => {
    assert({
      given: 'the launch config while Broadcast and Recording are unbuilt',
      should: 'keep Watch closed',
      actual: launched.watch,
      expected: false,
    });
  });
});
