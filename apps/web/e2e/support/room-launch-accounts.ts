import type { Browser } from '@playwright/test';
import { origin, signUpBotDebater, signUpMember } from './accounts';
import { createLaunchContexts } from './room-launch-contexts';
import { settleLeftRounds } from './settle-left-round';

/** Use only in a dedicated suite-owned Launch slot, retained until proof release. */
export async function createRoomLaunchAccounts(
  browser: Browser,
  count: number,
  /** The accounts host bot debates: each gets the operator override (ADR 0921). */
  options: { readonly botDebates?: boolean } = {},
) {
  const accounts = await createLaunchContexts(
    count,
    () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: false }),
    (context) =>
      options.botDebates
        ? signUpBotDebater(context.request)
        : signUpMember(context.request),
  );
  let closing: Promise<void> | undefined;
  return {
    ...accounts,
    /** Leaves no live Round behind, then closes every context, once. */
    closeContexts: () =>
      (closing ??= settleLeftRounds(accounts.members).then(
        accounts.closeContexts,
      )),
  };
}
