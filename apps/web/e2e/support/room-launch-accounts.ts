import type { Browser } from '@playwright/test';
import { origin, signUpMember } from './accounts';
import { createLaunchContexts } from './room-launch-contexts';

/** Use only in a dedicated suite-owned Launch slot, retained until proof release. */
export function createRoomLaunchAccounts(browser: Browser, count: number) {
  return createLaunchContexts(
    count,
    () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true }),
    (context) => signUpMember(context.request),
  );
}
