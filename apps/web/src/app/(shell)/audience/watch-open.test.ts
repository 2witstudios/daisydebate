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

/** Where a call was redirected, or null when it failed or finished in place. */
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

describe('with Watch open', () => {
  test('the flag is open', () => {
    assert({
      given: 'the launch config once WATCH-4 passes',
      should: 'open Watch, which this suite relies on',
      actual: launched.watch,
      expected: true,
    });
  });

  test('no audience server action answers with the explainer', async () => {
    const actions = [
      () => postSpectatorChatAction(target, previous, form),
      () => reactToRoundAction(target, previous, form),
      () => setDebaterFollowAction(follow, previous, form),
      () => reportFromPageAction('/watch/round', form),
    ];
    const destinations = await Promise.all(actions.map(redirectedTo));
    assert({
      given: 'a call to each action, outside any request',
      should: 'pass the launch gate and go on to read the request',
      actual: destinations.filter((path) => path === '/coming-soon/watch'),
      expected: [],
    });
  });

  test('a closed flag still mounts no spectator chat in a debater Room', async () => {
    assert({
      given: 'the seated chat told Watch is closed',
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
