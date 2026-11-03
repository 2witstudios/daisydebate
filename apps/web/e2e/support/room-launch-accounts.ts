import type { Browser } from '@playwright/test';
import { origin, signUpMember } from './accounts';
import { createLaunchContexts } from './room-launch-contexts';
import { settleLeftRound } from './settle-left-round';

/** Use only in a dedicated suite-owned Launch slot, retained until proof release. */
export async function createRoomLaunchAccounts(
  browser: Browser,
  count: number,
) {
  const accounts = await createLaunchContexts(
    count,
    () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: false }),
    (context) => signUpMember(context.request),
  );
  let closing: Promise<void> | undefined;
  return {
    ...accounts,
    /** Leaves no live Round behind, then closes every context, once. */
    closeContexts: () =>
      (closing ??= Promise.all(accounts.members.map(settleLeftRound)).then(
        accounts.closeContexts,
      )),
  };
}
