import { assert, setupRitewayBun, test } from 'riteway/bun';
import { clearedCookieNames } from './cleared-cookies';

setupRitewayBun();

test('the cookies a sign-out clears are named from its Set-Cookie headers (ISSUE-691)', () => {
  assert({
    given:
      'the session token and session data expiries, a secure-prefixed one, and a malformed header',
    should: 'name each cleared cookie and skip what is not a cookie name',
    actual: clearedCookieNames([
      'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
      'better-auth.session_data=; Max-Age=0; Path=/',
      '__Secure-better-auth.session_token=; Max-Age=0; Path=/; Secure',
      'not a cookie',
    ]),
    expected: [
      'better-auth.session_token',
      'better-auth.session_data',
      '__Secure-better-auth.session_token',
    ],
  });
});
