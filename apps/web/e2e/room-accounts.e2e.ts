import type { Browser } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import { sessionUsername } from './support/accounts';
import {
  createRoomAccounts,
  RoomAccountsSetupError,
} from './support/room-accounts';

type RoomGroup = Awaited<ReturnType<typeof createRoomAccounts>>;

/** Retain earlier groups if a later setup fails; await every teardown. */
async function usingRoomGroups(
  browser: Browser,
  sizes: readonly number[],
  proof: (groups: readonly RoomGroup[]) => Promise<void>,
) {
  const groups: RoomGroup[] = [];
  let failed = false;
  let failure: unknown;
  try {
    for (const size of sizes)
      groups.push(await createRoomAccounts(browser, size));
    await proof(groups);
  } catch (error) {
    failed = true;
    failure = error;
  }
  const outcomes = await Promise.allSettled(
    groups.map((group) => group.dispose()),
  );
  if (outcomes.some((outcome) => outcome.status === 'rejected'))
    throw new Error('Room account proof could not confirm all group cleanup');
  if (failed) throw failure;
}

test('ROOM-6.1 creates distinct real actors in separate contexts and removes only its own data', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await usingRoomGroups(
    browser,
    [1, 3],
    async ([sentinelGroup, ownedGroup]) => {
      const sentinel = sentinelGroup!;
      const group = ownedGroup!;
      const baseline = await sentinel.inspect();
      const owned = await group.inspect();
      expect([owned.users, owned.actors]).toEqual([3, 3]);
      expect(owned.session).toBeGreaterThanOrEqual(3);
      expect(owned.delivery).toBeGreaterThanOrEqual(3);
      const ids = [...group.members, ...sentinel.members].map(
        (member) => member.userId,
      );
      expect(new Set(ids).size).toBe(4);
      for (const member of group.members) {
        const page = await openPage(member.context, 'ROOM-6.1 signed-in actor');
        expect((await sessionUsername(page)) === member.username).toBe(true);
      }
      const evidence = await group.dispose();
      expect(Object.values(evidence.after).every((count) => count === 0)).toBe(
        true,
      );
      expect(await sentinel.inspect()).toEqual(baseline);
      // This is a second database cleanup, not only an already-closed context.
      const repeated = await group.dispose();
      expect(Object.values(repeated.before).every((count) => count === 0)).toBe(
        true,
      );
      expect(Object.values(repeated.after).every((count) => count === 0)).toBe(
        true,
      );
    },
  );
});

test('ROOM-6.1 two helper invocations do not share cookies or sessions', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await usingRoomGroups(browser, [1, 2], async ([firstGroup, secondGroup]) => {
    const first = firstGroup!;
    const second = secondGroup!;
    const member = first.members[0]!;
    await member.context.addCookies([
      {
        name: 'room-fixture-isolation',
        value: 'first',
        url: 'https://localhost',
      },
    ]);
    for (const other of second.members) {
      const cookies = await other.context.cookies();
      expect(
        cookies.some((cookie) => cookie.name === 'room-fixture-isolation'),
      ).toBe(false);
      const response = await other.context.request.get('/api/auth/get-session');
      const session = await response.json();
      expect(session.user.id === member.userId).toBe(false);
      expect(session.user.id === other.userId).toBe(true);
    }
  });
});

test('ROOM-6.1 removes partial signup after a real confirmation whose acknowledgement is lost', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const contextsBefore = browser.contexts().length;
  let failure: unknown;
  try {
    await createRoomAccounts(browser, 3, {
      afterPost: async (path, index) => {
        if (path === '/auth/confirm' && index === 1)
          throw new Error('Injected lost acknowledgement');
      },
    });
  } catch (error) {
    failure = error;
  }
  expect(failure instanceof RoomAccountsSetupError).toBe(true);
  if (!(failure instanceof RoomAccountsSetupError))
    throw new Error('Missing owned cleanup evidence');
  expect(failure.cleanup.before.users).toBe(2);
  expect(failure.cleanup.before.actors).toBe(1);
  expect(failure.cleanup.before.session).toBeGreaterThanOrEqual(2);
  expect(
    Object.values(failure.cleanup.after).every((count) => count === 0),
  ).toBe(true);
  expect(browser.contexts().length).toBe(contextsBefore);
});
