import { idle } from '../../../features/forms/form-state';
import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
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
  judge: 'ai' as const,
};

const noopAction = async () => idle();

const render = (props: Parameters<typeof BotSelectorPage>[0]) =>
  renderAccessible(
    h(AppRouterContext, { value: router }, h(BotSelectorPage, props)),
  );

describe('BotSelectorPage', () => {
  test('says what its opponents are', () => {
    const page = render({ view, action: noopAction });
    const intro = page
      .all('paragraph')
      .find((paragraph) =>
        paragraph.textContent?.includes('Each opponent is an AI debater.'),
      );
    assert({
      given: 'the Train landing',
      should:
        'say under its heading that each opponent is an AI and the round is unranked',
      actual: [
        intro !== undefined,
        intro !== undefined &&
          Boolean(
            page
              .get('heading', 'Train', { level: 1 })
              .compareDocumentPosition(intro) & 4,
          ),
        page.textContent().includes('unranked'),
      ],
      expected: [true, true, true],
    });
  });

  test('the landing posts Start practice for the chosen opponent', () => {
    const page = render({ view, action: noopAction });
    const start = page.get('form', 'Start practice') as HTMLFormElement;
    const all = page.within('navigation', 'All opponents');
    assert({
      given: 'an available landing with a chosen opponent',
      should:
        'post the chosen actor id, name its action, and link every opponent by address',
      actual: [
        (start.elements.namedItem('bot') as HTMLInputElement | null)?.value,
        page.within('form', 'Start practice').has('button', 'Start practice'),
        all.attribute('link', 'Wren', 'href'),
        all.has('link', 'Juno', { current: true }),
      ],
      expected: [
        'juno-actor-id-000000',
        true,
        '/train?bot=wren-actor-id-000000',
        true,
      ],
    });
  });

  test('a member without the casual AI judge is offered a person to judge', () => {
    const offered = render({
      view: { ...view, judge: 'person' },
      action: noopAction,
    });
    const said = offered.within('form', 'Start practice').textContent();
    const posts = offered.has('form', 'Start practice');
    assert({
      given: 'a landing whose judge is a person',
      should: 'still post Start practice and say plainly who judges',
      actual: [
        posts,
        said.includes('AI judging on casual rounds is premium'),
        said.includes('invite a person to judge'),
        render({ view, action: noopAction })
          .textContent()
          .includes('is premium'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('an unavailable landing says so instead of offering a broken post', () => {
    const page = render({
      view: { ...view, available: false },
      action: noopAction,
    });
    assert({
      given: 'a roster whose AI seats are unavailable',
      should: 'render the truthful status and no practice button',
      actual: [
        page.text('status').includes('Practice is unavailable right now'),
        page.count('button', undefined, { hidden: true }),
      ],
      expected: [true, 0],
    });
  });

  test('an empty roster offers nothing', () => {
    const page = render({
      view: {
        opponents: [],
        chosen: null,
        available: false,
        judge: 'ai' as const,
      },
      action: noopAction,
    });
    assert({
      given: 'no opponents in the roster',
      should: 'say so and render no card or form',
      actual: [
        page.text('status').includes('No opponents are available yet'),
        page.count('button', undefined, { hidden: true }),
        page.count('article', undefined, { hidden: true }),
      ],
      expected: [true, 0, 0],
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
