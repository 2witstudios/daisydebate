import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createLaunchContexts } from '../e2e/support/room-launch-contexts';

setupRitewayBun();

function probe(failSignup = false) {
  const closed: number[] = [];
  const accounts: number[] = [];
  let opened = 0;
  return {
    closed,
    accounts,
    open: async () => {
      const id = ++opened;
      return {
        id,
        close: async () => {
          closed.push(id);
        },
      };
    },
    signup: async (context: { id: number }) => {
      accounts.push(context.id);
      if (failSignup && context.id === 2) throw new Error('partial signup');
      return { username: `member${context.id}` };
    },
  };
}

describe('Launch proof context lifetime', () => {
  test('failed closure attempts every owned context and cannot report teardown success', async () => {
    const attempted: number[] = [];
    let next = 0;
    const owned = await createLaunchContexts(
      2,
      async () => {
        const id = ++next;
        return {
          close: async () => {
            attempted.push(id);
            if (id === 1) throw new Error('driver failure');
          },
        };
      },
      async () => ({ username: 'retained-member' }),
    );
    const messages: string[] = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      try {
        await owned.closeContexts();
      } catch (error) {
        if (error instanceof Error) messages.push(error.message);
      }
    }
    assert({
      given: 'one driver closure failure and repeated teardown',
      should:
        'attempt both contexts exactly once and keep the failure visible without deleting account data',
      actual: [attempted, messages],
      expected: [
        [1, 2],
        Array(2).fill(
          'Launch contexts could not all close; suite-owned slot data retained',
        ),
      ],
    });
  });
  test('retains accounts until suite-owned slot teardown and closes contexts once', async () => {
    const calls = probe();
    const owned = await createLaunchContexts(2, calls.open, calls.signup);
    assert({
      given: 'two completed authenticated signup operations',
      should: 'retain their contexts and identity data for Round assertions',
      actual: [
        owned.members.map(({ username }) => username),
        calls.accounts,
        calls.closed,
      ],
      expected: [['member1', 'member2'], [1, 2], []],
    });
    await owned.closeContexts();
    await owned.closeContexts();
    assert({
      given: 'repeated context teardown',
      should:
        'close each context once while keeping account history for slot destruction',
      actual: [calls.closed, calls.accounts],
      expected: [
        [1, 2],
        [1, 2],
      ],
    });
  });

  test('partial signup awaits failure and closes every opened context', async () => {
    const calls = probe(true);
    let message = '';
    try {
      await createLaunchContexts(3, calls.open, calls.signup);
    } catch (error) {
      if (error instanceof Error) message = error.message;
    }
    assert({
      given: 'a second signup that created data before failing',
      should:
        'close both contexts, never start a third signup and retain partial account data for slot teardown',
      actual: [calls.closed, calls.accounts, message],
      expected: [
        [1, 2],
        [1, 2],
        'Launch account setup failed; suite-owned slot data retained',
      ],
    });
  });

  test('invalid count refuses before opening any context', async () => {
    const calls = probe();
    let refused = 0;
    for (const count of [0, -1, 1.5, NaN]) {
      try {
        await createLaunchContexts(count, calls.open, calls.signup);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Invalid Launch account count'
        )
          refused++;
      }
    }
    assert({
      given: 'invalid account counts',
      should: 'perform no browser or signup operations',
      actual: [refused, calls.accounts, calls.closed],
      expected: [4, [], []],
    });
  });
});
