import { FormData as BrowserFormData } from 'happy-dom';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './ballot-authoring-editor.test-support';

setupRitewayBun();

/** The editor mounted in a browser, with readers of its judge preview. */
const mountEditor = async () => {
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./ballot-authoring-editor.test-support', import.meta.dir),
    {
      self: { setTimeout: () => 0, clearTimeout: () => {} },
      URL,
      URLSearchParams,
      FormData: BrowserFormData,
      performance,
      TextEncoder,
      process: { env: { NODE_ENV: 'test' } },
    },
  );
  const { act, container, browser } = client;
  const preview = () =>
    container.querySelector('[aria-label="Preview of the judge\'s ballot"]')!;
  const read = () => ({
    status:
      [...preview().querySelectorAll('p[id]')].find(
        (paragraph) =>
          paragraph.id === preview().getAttribute('aria-describedby'),
      )?.textContent ?? null,
    places: preview().textContent.includes('Who placed where?'),
    max:
      preview().querySelector('input[type="range"]')?.getAttribute('max') ??
      null,
  });
  /** Sets a control's value as a person would, so React sees the change. */
  const enter = (selector: string, value: string, type: 'change' | 'input') =>
    act(async () => {
      const control = container.querySelector(selector)!;
      const prototype =
        control.tagName === 'SELECT'
          ? browser.HTMLSelectElement.prototype
          : browser.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
        control,
        value,
      );
      control.dispatchEvent(new browser.Event(type, { bubbles: true }));
    });
  /** Clicks the publish form's first button labelled `label`. */
  const press = (label: string) =>
    act(async () => {
      const button = [...container.querySelectorAll('button')].find(
        (candidate) => candidate.textContent.trim() === label,
      )!;
      button.dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
    });
  return { ...client, preview, read, enter, press };
};

test('the preview follows the host before anything is saved', async () => {
  const {
    act,
    createElement,
    root,
    EditorHarness,
    authoringView,
    leagueDefinitionId,
    read,
    enter,
  } = await mountEditor();
  try {
    await act(async () =>
      root.render(createElement(EditorHarness, { view: authoringView() })),
    );
    const saved = read();
    await enter(
      'select[name="ballot-version"]',
      `${leagueDefinitionId}@3`,
      'change',
    );
    const picked = read();
    await enter('input[name="score-max"]', '40', 'input');
    const drafted = read();
    await enter('input[name="score-max"]', '', 'input');
    const unfinished = read();
    assert({
      given:
        'the saved version 2, then version 3 picked, then the publish form’s maximum set to 40, then emptied',
      should:
        'draw the saved ballot, then version 3’s places, then the draft’s 20 to 40 scale, then keep that scale while the draft is unfinished',
      actual: { saved, picked, drafted, unfinished },
      expected: {
        saved: {
          status:
            'The saved ballot, version 2. Changes you make here show before you save.',
          places: false,
          max: '30',
        },
        picked: {
          status: "League ballot, version 3: not yet this event's ballot.",
          places: true,
          max: null,
        },
        drafted: {
          status:
            'An unpublished draft. Name it to publish it; judges get it only once it is published and selected.',
          places: false,
          max: '40',
        },
        unfinished: {
          status:
            'An unpublished draft, as it last stood complete. Finish its fields to preview the rest.',
          places: false,
          max: '40',
        },
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
});

test('the preview reads fields a change reveals', async () => {
  const {
    act,
    createElement,
    root,
    container,
    EditorHarness,
    authoringView,
    preview,
    read,
    enter,
  } = await mountEditor();
  const state = () => ({
    places: read().places,
    doubleLossOffered: preview().textContent.includes('A loss for both'),
    doubleLossChecked:
      (
        container.querySelector('input[name="double-loss"]') as {
          readonly checked?: boolean;
        } | null
      )?.checked ?? null,
  });
  try {
    await act(async () =>
      root.render(createElement(EditorHarness, { view: authoringView() })),
    );
    await enter('select[name="decision"]', 'ranking-sides', 'change');
    const ranked = state();
    await enter('select[name="decision"]', 'winner', 'change');
    const winnerAgain = state();
    assert({
      given:
        'a saved winner ballot allowing a loss for both, its decision set to Rank sides and back to Winner',
      should:
        'draw places, then the loss for both the revealed (checked) toggle now publishes',
      actual: { ranked, winnerAgain },
      expected: {
        ranked: {
          places: true,
          doubleLossOffered: false,
          doubleLossChecked: null,
        },
        winnerAgain: {
          places: false,
          doubleLossOffered: true,
          doubleLossChecked: true,
        },
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
});

test('the preview follows a removed criterion', async () => {
  const {
    act,
    createElement,
    root,
    container,
    EditorHarness,
    authoringView,
    leagueDefinitionId,
    leagueGridBallot,
    preview,
    press,
  } = await mountEditor();
  const criteria = () => ({
    reasoning: preview().textContent.includes('Reasoning'),
    delivery: preview().textContent.includes('Delivery'),
    // What a server-rendered field shows until it is typed in.
    firstSeed: container
      .querySelector('input[name="group-0-criterion-0-name"]')
      ?.getAttribute('value'),
  });
  try {
    await act(async () =>
      root.render(
        createElement(EditorHarness, {
          view: authoringView({
            definition: {
              source: { kind: 'stored', id: leagueDefinitionId, version: 2 },
              ballot: leagueGridBallot,
            },
            definitions: [
              {
                id: leagueDefinitionId,
                name: 'League ballot',
                owned: true,
                currentVersion: 2,
                versions: [
                  {
                    version: 2,
                    definition: leagueGridBallot,
                    compatible: true,
                  },
                ],
              },
            ],
          }),
        }),
      ),
    );
    const saved = criteria();
    await press('Remove criterion');
    const removed = criteria();
    assert({
      given:
        'a saved ballot scored on Reasoning and Delivery, its first criterion removed in the publish form',
      should:
        'draw both criteria, then only Delivery, its row still seeded with Delivery',
      actual: { saved, removed },
      expected: {
        saved: { reasoning: true, delivery: true, firstSeed: 'Reasoning' },
        removed: { reasoning: false, delivery: true, firstSeed: 'Delivery' },
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
});

test('a reset form takes the preview back with it', async () => {
  const {
    act,
    createElement,
    root,
    container,
    EditorHarness,
    authoringView,
    leagueDefinitionId,
    read,
    enter,
  } = await mountEditor();
  /** Resets the form holding `selector`, as React does after a refused post. */
  const reset = (selector: string) =>
    act(async () =>
      (
        container.querySelector(selector)!.closest('form') as unknown as {
          reset(): void;
        }
      ).reset(),
    );
  try {
    await act(async () =>
      root.render(createElement(EditorHarness, { view: authoringView() })),
    );
    await enter(
      'select[name="ballot-version"]',
      `${leagueDefinitionId}@3`,
      'change',
    );
    // The server renders the saved option `selected`, which a reset restores
    // (happy-dom ignores the defaultSelected a client render sets instead).
    container
      .querySelector(`option[value="${leagueDefinitionId}@2"]`)!
      .setAttribute('selected', '');
    await reset('select[name="ballot-version"]');
    const pinReset = read();
    await enter('input[name="score-max"]', '40', 'input');
    await reset('input[name="score-max"]');
    const publishReset = read();
    assert({
      given:
        'version 3 picked and its form reset, then the maximum set to 40 and the publish form reset',
      should:
        'draw the saved ballot again, then the reset form’s maximum of 30',
      actual: { pinReset, publishReset: publishReset.max },
      expected: {
        pinReset: {
          status:
            'The saved ballot, version 2. Changes you make here show before you save.',
          places: false,
          max: '30',
        },
        publishReset: '30',
      },
    });
  } finally {
    await act(async () => root.unmount());
  }
});

test('a refused publish leaves its fields showing their own state', async () => {
  const {
    act,
    createElement,
    hydrateRoot,
    renderToString,
    container,
    EditorHarness,
    authoringView,
    leagueDefinitionId,
    refusedPublish,
    enter,
    press,
  } = await mountEditor();
  const has = (selector: string) => container.querySelector(selector) !== null;
  const valueOf = (name: string) =>
    (
      container.querySelector(`select[name="${name}"]`) as {
        readonly value?: string;
      } | null
    )?.value;
  /** Each select's shown value beside the fields its state has mounted. */
  const fields = () => ({
    target: valueOf('publish-target'),
    nameField: has('input[name="definition-name"]'),
    decision: valueOf('decision'),
    winnerToggles: has('input[name="double-loss"]'),
    scores: valueOf('score-subject'),
    scaleFields: has('input[name="score-min"]'),
    reason: valueOf('reason-rule'),
    reasonLength: has('input[name="reason-max"]'),
  });
  const editor = createElement(EditorHarness, {
    view: authoringView(),
    publish: refusedPublish,
  });
  // As the page arrives: server markup, whose `selected` options are what a
  // form reset returns its selects to, then hydrated.
  container.innerHTML = renderToString(editor);
  let hydrated: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      hydrated = hydrateRoot(container as unknown as Element, editor);
    });
    await enter('select[name="publish-target"]', leagueDefinitionId, 'change');
    await enter('select[name="decision"]', 'ranking-sides', 'change');
    await enter('select[name="score-subject"]', 'none', 'change');
    await enter('select[name="reason-rule"]', 'off', 'change');
    const edited = fields();
    await press('Publish definition');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const refusal = container.textContent.includes(
      'This ballot changed. Review it and publish again.',
    );
    const after = fields();
    assert({
      given:
        'four selects changed in the publish form, then a publish the server refuses',
      should:
        'reset each select and the fields it shows together, back to the saved ballot',
      actual: { edited, refusal, after },
      expected: {
        edited: {
          target: leagueDefinitionId,
          nameField: false,
          decision: 'ranking-sides',
          winnerToggles: false,
          scores: 'none',
          scaleFields: false,
          reason: 'off',
          reasonLength: false,
        },
        refusal: true,
        // The saved ballot: a winner between sides, scored per side, with a
        // required reason, published as a new definition.
        after: {
          target: 'new',
          nameField: true,
          decision: 'winner',
          winnerToggles: true,
          scores: 'side',
          scaleFields: true,
          reason: 'required',
          reasonLength: true,
        },
      },
    });
  } finally {
    await act(async () => hydrated?.unmount());
  }
});
