import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from './destinations';
import { resolveExplainer } from './resolve';

setupRitewayBun();

const config = (open: string) =>
  Object.fromEntries(
    destinationSlugs.map((slug) => [slug, slug === open]),
  ) as Record<(typeof destinationSlugs)[number], boolean>;

describe('resolveExplainer', () => {
  test('an unknown segment is not found', () => {
    assert({
      given: 'a segment that is not a destination',
      should: 'resolve to not-found',
      actual: resolveExplainer('nowhere', config('')).kind,
      expected: 'not-found',
    });
  });

  test('an unlaunched destination shows its explainer', () => {
    const result = resolveExplainer('ranked', config(''));
    assert({
      given: 'ranked while nothing is launched',
      should: 'show the ranked copy',
      actual: result.kind === 'show' && result.destination.slug,
      expected: 'ranked',
    });
  });

  test('a launched destination redirects to its live route', () => {
    assert({
      given: 'lobby flipped to launched',
      should: 'redirect to /lobby and leave the others showing',
      actual: [
        resolveExplainer('lobby', config('lobby')),
        resolveExplainer('watch', config('lobby')).kind,
      ],
      expected: [{ kind: 'redirect', to: '/lobby' }, 'show'],
    });
  });
});
