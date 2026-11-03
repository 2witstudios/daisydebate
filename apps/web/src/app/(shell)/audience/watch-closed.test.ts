import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { launched } from '../../../features/coming-soon/launch';
import {
  postSpectatorChatAction,
  reactToRoundAction,
  reportFromPageAction,
  setDebaterFollowAction,
} from './actions';
import { SeatedSpectatorChat } from './seated-spectator-chat';

setupRitewayBun();

/** Where a call was redirected, or what it threw when it was not. */
const redirectedTo = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (error) {
    return String((error as { digest?: unknown }).digest).split(';')[2] ?? null;
  }
};

const target = { roundId: 'round', returnTo: '/watch/round' };
const follow = {
  username: 'ana',
  state: 'following',
  returnTo: '/profile/ana',
} as const;
const previous = { values: {} };
const form = new FormData();

/** The builder's launch flip replaces this suite, as it does launch-gate's. */
describe('while Watch is closed', () => {
  test('the flag is closed', () => {
    assert({
      given: 'the launch config before WATCH-4 passes',
      should: 'keep Watch closed, which this suite relies on',
      actual: launched.watch,
      expected: false,
    });
  });

  test('every audience server action answers with the explainer', async () => {
    const actions = [
      () => postSpectatorChatAction(target, previous, form),
      () => reactToRoundAction(target, previous, form),
      () => setDebaterFollowAction(follow, previous, form),
      () => reportFromPageAction('/watch/round', form),
    ];
    assert({
      given: 'a forged call to each action, bound to no open page',
      should: 'redirect before any route or request is read',
      actual: await Promise.all(actions.map(redirectedTo)),
      expected: actions.map(() => '/coming-soon/watch'),
    });
  });

  test('a debater Room mounts no spectator chat', async () => {
    assert({
      given: 'the seated chat with Watch closed',
      should: 'render nothing and read nothing of the audience',
      actual: await SeatedSpectatorChat({
        roundId: 'round',
        actorId: 'actor',
        watchOpen: false,
      }),
      expected: null,
    });
  });
});
