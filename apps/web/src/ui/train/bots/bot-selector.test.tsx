import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BotSelectorPage } from './bot-selector';
import { portraitLook } from './looks';

setupRitewayBun();

const router = {
  bfcacheId: 'test',
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

const view = {
  opponents: [
    {
      actorId: 'wren-actor-id-000000',
      name: 'Wren',
      persona: 'Quick and dry',
      difficulty: 'intermediate' as const,
      eligible: true,
      selected: false,
      href: '/train?bot=wren-actor-id-000000',
    },
    {
      actorId: 'juno-actor-id-000000',
      name: 'Juno',
      persona: 'Warm and loud',
      difficulty: 'beginner' as const,
      eligible: true,
      selected: true,
      href: '/train',
    },
  ],
  chosen: {
    actorId: 'juno-actor-id-000000',
    name: 'Juno',
    persona: 'Warm and loud',
    difficulty: 'beginner' as const,
    eligible: true,
    selected: true,
    href: '/train',
  },
  available: true,
};

const noopAction = async () => ({ values: {} });

const render = (props: Parameters<typeof BotSelectorPage>[0]) =>
  renderToString(
    h(AppRouterContext, { value: router }, h(BotSelectorPage, props)),
  );

describe('BotSelectorPage', () => {
  test('the landing posts Start practice for the chosen opponent', () => {
    const html = render({ view, action: noopAction });
    assert({
      given: 'an available landing with a chosen opponent',
      should:
        'post the chosen actor id, name its action, and link every opponent by address',
      actual: [
        html.includes('name="bot" value="juno-actor-id-000000"'),
        html.includes('aria-label="Start practice"'),
        html.includes('href="/train?bot=wren-actor-id-000000"'),
        html.includes('aria-current="true"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('an unavailable landing says so instead of offering a broken post', () => {
    const html = render({
      view: { ...view, available: false },
      action: noopAction,
    });
    assert({
      given: 'a roster whose AI seats are unavailable',
      should: 'render the truthful status and no practice button',
      actual: [
        html.includes('Practice is unavailable right now'),
        html.includes('type="submit"'),
      ],
      expected: [true, false],
    });
  });

  test('an empty roster offers nothing', () => {
    const html = render({
      view: { opponents: [], chosen: null, available: false },
      action: noopAction,
    });
    assert({
      given: 'no opponents in the roster',
      should: 'say so and render no card or form',
      actual: [
        html.includes('No opponents are available yet'),
        html.includes('type="submit"'),
      ],
      expected: [true, false],
    });
  });
});

describe('the named looks', () => {
  test('shipped portraits map by durable name and nothing else', () => {
    const wren = portraitLook('Wren');
    const juno = portraitLook('Juno');
    const stranger = portraitLook('Nyx');
    assert({
      given: 'the seeded roster names and an unmapped name',
      should:
        'return each mapped character its own look and no invented identity for the stranger',
      actual: [
        [wren?.skin, wren?.hairStyle],
        [juno?.skin, juno?.hairStyle],
        stranger,
      ],
      expected: [['#f5d6be', 'sweep'], ['#8d5a3b', 'curly'], null],
    });
  });
});
