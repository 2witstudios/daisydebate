import { assert, setupRitewayBun, test } from 'riteway/bun';
import { pageContext } from './confirm-http-shared';

setupRitewayBun();

const validNonce = Buffer.from(
  crypto.getRandomValues(new Uint8Array(16)),
).toString('base64');

const request = (headers: Record<string, string>) =>
  new Request('https://daisy.invalid/auth/confirm', { headers });

test('pageContext: a valid x-nonce header is carried through', () => {
  const ctx = pageContext(request({ 'x-nonce': validNonce }));
  assert({
    given: 'a request carrying the proxy-minted x-nonce header',
    should: 'return that exact nonce',
    actual: ctx.nonce,
    expected: validNonce,
  });
});

test('pageContext: a missing x-nonce header renders unstyled (fail safe)', () => {
  const ctx = pageContext(request({}));
  assert({
    given: 'a request with no x-nonce header',
    should: 'return an undefined nonce, never a fabricated one',
    actual: ctx.nonce,
    expected: undefined,
  });
});

test('pageContext: a malformed x-nonce header is refused, not trusted (negative control)', () => {
  const malformed = [
    'not-base64-shaped!!',
    'short==',
    `${validNonce.slice(0, 10)}<script>`,
    '',
  ];
  const results = malformed.map(
    (value) => pageContext(request({ 'x-nonce': value })).nonce,
  );
  assert({
    given: 'x-nonce headers that do not match the proxy-handler nonce shape',
    should: 'never be accepted as the nonce',
    actual: results,
    expected: malformed.map(() => undefined),
  });
});

test('pageContext: the theme cookie is read through the same trust boundary as the app', () => {
  const withCookie = pageContext(
    request({ cookie: 'daisy-theme=light; other=1' }),
  ).theme;
  const withoutCookie = pageContext(request({})).theme;
  const withGarbage = pageContext(
    request({ cookie: 'daisy-theme=not-a-real-theme' }),
  ).theme;
  assert({
    given: 'a valid theme cookie, no cookie, and an invalid theme value',
    should: 'parse the valid one, and default the other two',
    actual: [withCookie, withoutCookie, withGarbage],
    expected: ['light', 'dark', 'dark'],
  });
});
