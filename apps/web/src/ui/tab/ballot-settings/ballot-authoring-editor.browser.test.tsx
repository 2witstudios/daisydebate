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

/**
 * The editor mounted as the page arrives (server markup, then hydrated, so
 * its `selected` options are what a reset returns selects to) or by a client
 * render; the host edits three selects and a scale field, then posts.
 */
const postEdits = async ({
  answer,
  hydrate,
  alone = false,
}: {
  readonly answer: 'refused' | 'unacknowledged' | 'accepted';
  readonly hydrate: boolean;
  /** The definition fields in their form, without the editor's preview. */
  readonly alone?: boolean;
}) => {
  const editor = await mountEditor();
  const {
    act,
    createElement,
    hydrateRoot,
    renderToString,
    root,
    container,
    EditorHarness,
    FieldsHarness,
    authoringView,
    leagueDefinitionId,
    refusedPublish,
    unacknowledgedPublish,
    enter,
    press,
  } = editor;
  const has = (selector: string) => container.querySelector(selector) !== null;
  const valueOf = (selector: string) =>
    (container.querySelector(selector) as { readonly value?: string } | null)
      ?.value;
  /** Each select's shown value beside the fields its state has mounted. */
  const fields = () => ({
    target: valueOf('select[name="publish-target"]'),
    nameField: has('input[name="definition-name"]'),
    decision: valueOf('select[name="decision"]'),
    winnerToggles: has('input[name="double-loss"]'),
    reason: valueOf('select[name="reason-rule"]'),
    reasonLength: has('input[name="reason-max"]'),
    max: valueOf('input[name="score-max"]'),
  });
  const element = createElement(alone ? FieldsHarness : EditorHarness, {
    view: authoringView(),
    ...(answer === 'refused'
      ? { publish: refusedPublish }
      : answer === 'unacknowledged'
        ? { publish: unacknowledgedPublish }
        : {}),
  });
  let unmount = () => root.unmount();
  if (hydrate) {
    // A node of its own: the container already holds a client root.
    const page = container.ownerDocument.createElement('div');
    container.append(page);
    page.innerHTML = renderToString(element);
    await act(async () => {
      const hydrated = hydrateRoot(page as unknown as Element, element);
      unmount = () => hydrated.unmount();
    });
  } else await act(async () => root.render(element));
  await enter('select[name="publish-target"]', leagueDefinitionId, 'change');
  await enter('select[name="decision"]', 'ranking-sides', 'change');
  await enter('select[name="reason-rule"]', 'off', 'change');
  await enter('input[name="score-max"]', '40', 'input');
  const edited = fields();
  const focus = () =>
    act(async () =>
      (
        container.querySelector('input[name="score-max"]') as unknown as {
          focus(): void;
        }
      ).focus(),
    );
  await focus();
  await press('Publish definition');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const after = fields();
  const preview = alone ? null : editor.read();
  const focused = (
    container.ownerDocument.activeElement as { readonly name?: string } | null
  )?.name;
  const disabled =
    (
      container.querySelector('select[name="decision"]') as {
        readonly disabled?: boolean;
        closest(selector: string): { readonly disabled?: boolean } | null;
      }
    ).closest('fieldset:disabled') !== null;
  await act(async () => unmount());
  return { edited, after, preview, focused, disabled, leagueDefinitionId };
};

const draftShown = (league: string) => ({
  target: league,
  nameField: false,
  decision: 'ranking-sides',
  winnerToggles: false,
  reason: 'off',
  reasonLength: false,
  max: '40',
});

test('a refused publish keeps the draft, each select beside its own fields', async () => {
  const hydrated = await postEdits({ answer: 'refused', hydrate: true });
  const clientMounted = await postEdits({ answer: 'refused', hydrate: false });
  assert({
    given:
      'three selects and the maximum changed, then a publish the server refuses, on a server-rendered page and a client-rendered one',
    should:
      'show the draft again after the reset: each select with the fields it governs, the typed maximum, and the same draft in the preview',
    actual: [
      hydrated.edited,
      hydrated.after,
      clientMounted.after,
      hydrated.preview,
    ],
    expected: [
      draftShown(hydrated.leagueDefinitionId),
      draftShown(hydrated.leagueDefinitionId),
      draftShown(hydrated.leagueDefinitionId),
      // The preview draws the same draft: ranked sides on a 20 to 40 scale.
      {
        status:
          'An unpublished draft. Judges get it only once it is published and selected.',
        places: true,
        max: '40',
      },
    ],
  });
});

test('the definition fields keep their selects in step on their own', async () => {
  const { after, leagueDefinitionId } = await postEdits({
    answer: 'refused',
    hydrate: true,
    alone: true,
  });
  assert({
    given:
      'the definition fields alone in their command form, edited and refused',
    should:
      'show the draft with each select beside its own fields, needing no re-render from outside',
    actual: after,
    expected: draftShown(leagueDefinitionId),
  });
});

test('an answer that gives nothing back resets the fields together', async () => {
  const { after } = await postEdits({
    answer: 'accepted',
    hydrate: true,
    alone: true,
  });
  assert({
    given:
      'the definition fields alone in their form, edited and posted to an answer that returns no fields',
    should:
      'mount them afresh with the reset, each select beside its own fields, as saved',
    actual: after,
    expected: {
      target: 'new',
      nameField: true,
      decision: 'winner',
      winnerToggles: true,
      reason: 'required',
      reasonLength: true,
      max: '30',
    },
  });
});

test('a publish whose answer is lost shows the draft its retry posts', async () => {
  // Not the preview here: happy-dom's FormData keeps a disabled fieldset's
  // controls (a browser leaves them out), so it would read the draft twice.
  const { after, disabled, leagueDefinitionId } = await postEdits({
    answer: 'unacknowledged',
    hydrate: true,
  });
  assert({
    given: 'the edited draft posted and its answer lost',
    should: 'show that draft, disabled, in the fields beside Retry',
    actual: { after, disabled },
    expected: { after: draftShown(leagueDefinitionId), disabled: true },
  });
});

test('focus stays on its field through a reset', async () => {
  const { focused } = await postEdits({ answer: 'accepted', hydrate: true });
  assert({
    given: 'the maximum focused when the publish is posted and answered',
    should: 'keep focus on the maximum once the fields are mounted afresh',
    actual: focused,
    expected: 'score-max',
  });
});
