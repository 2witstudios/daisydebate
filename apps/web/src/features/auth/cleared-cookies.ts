/**
 * The cookies a sign-out response clears, by name, from its Set-Cookie
 * headers, so a server action can clear the same ones in the browser
 * without JavaScript (ISSUE-691). Only well-formed names are kept.
 */
export function clearedCookieNames(setCookies: readonly string[]): string[] {
  return setCookies
    .map((header) => header.split('=', 1)[0]?.trim() ?? '')
    .filter((name) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name));
}
