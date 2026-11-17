import { FormData as BrowserFormData } from 'happy-dom';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './ballot-authoring-editor.test-support';

setupRitewayBun();

test('the preview follows the host before anything is saved', async () => {
  const {
    act,
    createElement,
    root,
    container,
    browser,
    EditorHarness,
    authoringView,
    leagueDefinitionId,
  } = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./ballot-authoring-editor.test-support', import.meta.dir),
    {
      self: { setTimeout: () => 0, clearTimeout: () => {} },
      URL,
      URLSearchParams,
      FormData: BrowserFormData,
      performance,
      process: { env: { NODE_ENV: 'test' } },
    },
  );
  const preview = () =>
    container.querySelector('[aria-label="Preview of the judge\'s ballot"]')!;
  const read = () => ({
    status: preview().querySelector('[role="status"]')?.textContent ?? null,
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
            'An unpublished draft. Judges get it only once it is published and selected.',
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
