import { virtualClock } from '@daisy/clock/testing';
import type { PeopleList, Person } from '@daisy/protocol/people-list';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  challengeSent,
  initialChallengeForm,
} from '../../features/challenges/forms';
import { initialPersonBlock } from '../../features/contacts/block-form';
import { initialFriendForm } from '../../features/friends/forms';
import { creationIdle } from '../../features/messaging/forms/create-form';
import {
  initialReportForm,
  reported as filed,
} from '../../features/reports/form';
import { accessibleWithin } from '../../test-support/rendered/accessible';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { virtualBrowserTime } from '../test-support/virtual-browser-time.test-support';
import type * as Client from './person-menu.test-support';

setupRitewayBun();

const ada = (over: Partial<Person> = {}): Person => ({
  username: 'ada',
  displayName: null,
  photoId: null,
  status: 'online',
  relation: 'none',
  ratings: [
    {
      ladder: { style: 'freestyle', division: 'open' },
      rating: null,
      provisional: false,
      hidden: false,
    },
  ],
  division: 'open',
  challengeModes: ['ranked', 'casual'],
  wins: 0,
  losses: 0,
  ...over,
});
const list = (people: readonly Person[]): PeopleList => ({
  version: 1,
  people: [...people],
  nextCursor: null,
  counts: { everyone: people.length, friends: 0, online: people.length },
  self: 'online',
});

/** The menu over its providers in a private browser realm; closing and reporting are recorded. */
const mount = async (
  member: Person,
  reported = false,
  answers: { readonly sent?: boolean; readonly filed?: boolean } = {},
) => {
  const clock = virtualClock();
  const time = virtualBrowserTime(clock);
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./person-menu.test-support', import.meta.dir),
    (browser) => ({
      ...time.windowTimers,
      fetch: async () => new Response(null, { status: 404 }),
      URL,
      URLSearchParams,
      performance: { now: () => clock.nowMs() },
      crypto: { getRandomValues: (values: Uint32Array) => values.fill(0) },
      process: { env: { NODE_ENV: 'test' } },
      Element: browser.Element,
      HTMLElement: browser.HTMLElement,
      KeyboardEvent: browser.KeyboardEvent,
      self: browser,
      FormData: browser.FormData,
      location: browser.location,
      navigator: browser.navigator,
    }),
  );
  const said: string[] = [];
  const noop = () => {};
  const router = {
    bfcacheId: 'test',
    back: noop,
    forward: noop,
    refresh: noop,
    push: noop,
    replace: noop,
    prefetch: noop,
  };
  const actions = {
    friend: async () => initialFriendForm(member.username),
    sendChallenge: async () =>
      answers.sent ? challengeSent : initialChallengeForm,
    acceptChallenge: async () => initialChallengeForm,
    endChallenge: async () => initialChallengeForm,
    message: async () => creationIdle(''),
    report: async () => (answers.filed ? filed : initialReportForm),
    block: async () => initialPersonBlock,
  };
  const h = client.createElement;
  await client.act(async () =>
    client.root.render(
      h(client.AppRouterContext, {
        value: router,
        children: h(client.PeopleProvider, {
          initialList: list([member]),
          socketUrl: null,
          children: h(client.ChallengeProvider, {
            memberDivision: 'open',
            initialChallenges: {
              version: 1,
              incoming: [],
              outgoing: [],
              accepted: [],
            },
            actorId: null,
            socketUrl: null,
            children: h(client.PersonMenu, {
              member,
              actions,
              reported,
              onReported: () => said.push('reported'),
              top: 0,
              onClose: () => said.push('closed'),
            }),
          }),
        }),
      }),
    ),
  );
  const view = () => accessibleWithin(client.container as unknown as Element);
  const card = () => view().within('dialog', '@ada');
  const press = (name: string) =>
    client.act(async () => {
      (card().get('button', name) as HTMLElement).click();
    });
  return {
    ...client,
    said,
    view,
    card,
    press,
    focused: () => client.browser.document.activeElement?.textContent ?? null,
    close: async () => {
      await client.act(async () => client.root.unmount());
      await client.browser.happyDOM.abort();
    },
  };
};

describe('person menu', () => {
  test('the menu offers what the viewer can do with this person', async () => {
    const menu = await mount(ada());
    try {
      assert({
        given: 'an online stranger who takes challenges',
        should: 'offer to challenge, befriend, message, see, report and block',
        actual: menu.card().names('button'),
        expected: ['Challenge', 'Add friend', 'Message', 'Report', 'Block'],
      });
    } finally {
      await menu.close();
    }
  });

  test('Challenge opens the mode choice, starting at ranked, and Back returns', async () => {
    const menu = await mount(ada());
    try {
      await menu.press('Challenge');
      const opened = {
        pressed: menu.card().names('button', { pressed: true }),
        focus: menu.focused(),
        send: menu.card().has('button', 'Send challenge'),
      };
      await menu.press('Casual');
      const chosen = menu.card().names('button', { pressed: true });
      await menu.press('Back');
      await menu.press('Challenge');
      assert({
        given: 'the challenge view, a change to casual, and back again',
        should: 'start ranked, take focus, follow the choice and start over',
        actual: {
          opened,
          chosen,
          again: menu.card().names('button', { pressed: true }),
        },
        expected: {
          opened: { pressed: ['Ranked'], focus: 'Ranked', send: true },
          chosen: ['Casual'],
          again: ['Ranked'],
        },
      });
    } finally {
      await menu.close();
    }
  });

  test('a casual-only person starts the challenge at casual', async () => {
    const menu = await mount(ada({ challengeModes: ['casual'] }));
    try {
      await menu.press('Challenge');
      assert({
        given: 'a person who takes only casual challenges',
        should: 'start at casual with ranked unavailable',
        actual: {
          pressed: menu.card().names('button', { pressed: true }),
          ranked: menu.card().get('button', 'Ranked').hasAttribute('disabled'),
        },
        expected: { pressed: ['Casual'], ranked: true },
      });
    } finally {
      await menu.close();
    }
  });

  test('Report asks for a reason before it sends', async () => {
    const menu = await mount(ada());
    try {
      await menu.press('Report');
      const waiting = menu
        .card()
        .get('button', 'Send report')
        .hasAttribute('disabled');
      const focus = menu.focused();
      await menu.press('Spam');
      assert({
        given: 'the report view, then a reason',
        should: 'hold the send until a reason is chosen',
        actual: {
          waiting,
          focus: focus !== null,
          pressed: menu.card().names('button', { pressed: true }),
          ready: menu
            .card()
            .get('button', 'Send report')
            .hasAttribute('disabled'),
        },
        expected: {
          waiting: true,
          focus: true,
          pressed: ['Spam'],
          ready: false,
        },
      });
    } finally {
      await menu.close();
    }
  });

  test('a reported person cannot be reported again', async () => {
    const menu = await mount(ada(), true);
    try {
      assert({
        given: 'a person this viewer has reported',
        should: 'show Reported, unavailable',
        actual: menu.card().get('button', 'Reported').hasAttribute('disabled'),
        expected: true,
      });
    } finally {
      await menu.close();
    }
  });

  test('Escape and the scrim close the menu', async () => {
    const menu = await mount(ada());
    try {
      await menu.act(async () => {
        menu.browser.document.dispatchEvent(
          new menu.browser.KeyboardEvent('keydown', { key: 'Escape' }),
        );
      });
      await menu.act(async () => {
        menu.browser.document.dispatchEvent(
          new menu.browser.KeyboardEvent('keydown', { key: 'Enter' }),
        );
      });
      await menu.act(async () => {
        (
          menu.container.querySelector('[aria-hidden="true"]') as unknown as {
            click: () => void;
          }
        ).click();
      });
      assert({
        given: 'Escape, another key, and a click on the scrim',
        should: 'close for Escape and the scrim only',
        actual: menu.said,
        expected: ['closed', 'closed'],
      });
    } finally {
      await menu.close();
    }
  });

  test('a filed report says so and returns to the menu', async () => {
    const menu = await mount(ada(), false, { filed: true });
    try {
      await menu.press('Report');
      await menu.press('Spam');
      await menu.press('Send report');
      assert({
        given: 'a report the server filed',
        should: 'tell the owner and show the menu again',
        actual: {
          said: menu.said,
          menu: menu.card().has('button', 'Challenge'),
        },
        expected: { said: ['reported'], menu: true },
      });
    } finally {
      await menu.close();
    }
  });

  test('a sent challenge closes the menu', async () => {
    const menu = await mount(ada(), false, { sent: true });
    try {
      await menu.press('Challenge');
      await menu.press('Send challenge');
      assert({
        given: 'a challenge the server sent',
        should: 'close the menu',
        actual: menu.said,
        expected: ['closed'],
      });
    } finally {
      await menu.close();
    }
  });
});
