/** Uses only the admitted native slot's existing test administrator credentials. */
export function browserRuntimeTarget(
  testDatabaseUrl: string,
  browserDatabaseUrl: string,
  slot: string,
): string {
  const administrator = new URL(testDatabaseUrl);
  const browser = new URL(browserDatabaseUrl);
  if (
    !/^[a-z0-9_]+$/.test(slot) ||
    !['postgres:', 'postgresql:'].includes(administrator.protocol) ||
    !['localhost', '127.0.0.1'].includes(administrator.hostname) ||
    administrator.hostname !== browser.hostname ||
    administrator.port !== browser.port ||
    administrator.pathname !== `/daisy_wt_${slot}_test` ||
    browser.pathname !== `/daisy_wt_${slot}_e2e` ||
    administrator.search ||
    administrator.hash
  )
    throw new Error('Realtime browser fixture administrator slot refused');
  administrator.pathname = browser.pathname;
  return administrator.toString();
}
