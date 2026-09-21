import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { safeLocalDestination } from './redirect';

setupRitewayBun();

describe('safeLocalDestination', () => {
  test('keeps same-origin local paths with query and hash', () => {
    assert({
      given: 'a local path with a query string',
      should: 'return it unchanged',
      actual: safeLocalDestination('/play/abc?tab=rules#top'),
      expected: '/play/abc?tab=rules#top',
    });
  });

  test('falls back to /lobby for absent or empty input', () => {
    assert({
      given: 'no destination',
      should: 'use the default /lobby',
      actual: [
        safeLocalDestination(undefined),
        safeLocalDestination(null),
        safeLocalDestination(''),
      ],
      expected: ['/lobby', '/lobby', '/lobby'],
    });
  });

  test('rejects every external, protocol-relative and encoded bypass', () => {
    const bypasses = [
      'https://evil.example/x',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      '/%2Fevil.example',
      '/%5Cevil.example',
      '/%252F%252Fevil.example',
      '%2F%2Fevil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      '/\tevil',
      '/\n/evil.example',
      'lobby',
      '/..%2F..%2F//evil.example',
      '/ok?token=abc',
      '/ok?next=1&token=abc',
    ];
    assert({
      given: 'external, protocol-relative, encoded or token-bearing inputs',
      should: 'all fall back to /lobby',
      actual: bypasses.map((value) => safeLocalDestination(value)),
      expected: bypasses.map(() => '/lobby'),
    });
  });

  test('honors an explicit fallback', () => {
    assert({
      given: 'an unsafe value and a custom fallback',
      should: 'return the fallback',
      actual: safeLocalDestination('//evil', '/onboarding/username'),
      expected: '/onboarding/username',
    });
  });
});
