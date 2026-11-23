import { idle } from '../../../features/forms/form-state';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  RoomCatalogChoice,
  RoomView,
} from '@daisy/protocol/room-contract';
import {
  assemblySnapshot,
  unequalTemplate,
} from '../../../features/rooms/assembly.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { FormatChoice } from './format-choice';

setupRitewayBun();

const standard = (
  formatId: string,
  label: string,
  sortOrder: number,
): RoomCatalogChoice => ({
  ...unequalTemplate,
  formatId,
  formatVersion: 1,
  label,
  role: 'standard',
  family: null,
  leagues: [],
  sortOrder,
  rulesEdition: null,
  sourceUrl: null,
  preset: { ...unequalTemplate.preset, version: 2 },
});
const ids = {
  choose: 'c'.repeat(24),
  reset: 'r'.repeat(24),
  template: 't'.repeat(24),
};
const action = async () => idle();

const strike = {
  enabled: true as const,
  drawSize: 5,
  strikeWindowMs: 60_000,
  firstStriker: 'negative' as const,
  source: { kind: 'bank' as const, categories: ['policy' as const] },
};
const freestyle: RoomCatalogChoice = {
  ...standard('freestyle', 'Freestyle', 3),
  preset: {
    rankedEligible: false,
    version: 1,
    config: { ...unequalTemplate.preset.config, resolutionDraw: strike },
  },
};
const choices: readonly RoomCatalogChoice[] = [unequalTemplate, freestyle];

const render = (
  format: RoomView['format'],
  options: {
    readonly catalog?: readonly RoomCatalogChoice[];
    readonly view?: Partial<RoomView>;
  } = {},
) =>
  renderAccessible(
    <FormatChoice
      view={{ ...assemblySnapshot, format, ...options.view }}
      choices={options.catalog ?? choices}
      ids={ids}
      action={action}
    />,
  );
const tuple = (formatId: string, presetVersion: number, formatVersion = 1) =>
  JSON.stringify({ formatId, formatVersion, presetVersion });

/** The radios of the Format group, by their posted value. */
const radios = (view: AccessibleView) =>
  view
    .within('radiogroup', 'Format')
    .all('radio')
    .map((radio) => radio as HTMLInputElement);
/** Whether the radio with this value is checked. */
const checked = (view: AccessibleView, value: string) =>
  radios(view).some((radio) => radio.value === value && radio.checked);

/** The fields a submit button posts with its form. */
const posted = (button: Element) => {
  const form = (button as HTMLButtonElement).form;
  return Object.fromEntries(
    [...(form?.querySelectorAll('input[name]') ?? [])]
      .map((input) => input as HTMLInputElement)
      .filter((input) => input.type !== 'radio' || input.checked)
      .map((input) => [input.name, input.value]),
  );
};

const freestyleStandard: RoomView['format'] = {
  name: 'Freestyle',
  role: 'standard',
  leagues: [],
  basis: {
    formatId: 'freestyle',
    name: 'Freestyle',
    formatVersion: 1,
    presetVersion: 1,
    strikes: true,
  },
  standing: { kind: 'standard', formatId: 'freestyle' },
};
/** A Room running a draw, as a Freestyle Room does until its reveal. */
const drawView: Partial<RoomView> = {
  topic: null,
  executionPlan: { ...assemblySnapshot.executionPlan, resolutionDraw: strike },
};

describe('FormatChoice', () => {
  test('a room on the standard', () => {
    const view = render(freestyleStandard, { view: drawView });
    const fields = posted(view.get('button', 'Use this format'));
    assert({
      given: 'a casual room still running the Freestyle standard',
      should:
        'offer Freestyle plus Custom, check Freestyle, and post select-format before hydration',
      actual: {
        order: view
          .within('radiogroup', 'Format')
          .names('radio')
          .map((name) => name.split(' ')[0]),
        freestyleChecked: checked(view, tuple('freestyle', 1)),
        command: fields.type === 'select-format',
        intent: fields.intent === 'choose',
        submit: view.has('button', 'Use this format'),
        templateNotAStandard: checked(
          view,
          tuple(unequalTemplate.formatId, 5, unequalTemplate.formatVersion),
        ),
        backOffered: view.count('button', /^Back to/) > 0,
      },
      expected: {
        order: ['Freestyle', 'Custom'],
        freestyleChecked: true,
        command: true,
        intent: true,
        submit: true,
        templateNotAStandard: false,
        backOffered: false,
      },
    });
  });

  test('a room edited away from its standard', () => {
    const view = render(
      {
        ...freestyleStandard,
        standing: {
          kind: 'custom',
          basis: { formatId: 'freestyle', role: 'standard' },
          changes: [{ kind: 'in-round-prep', fromMs: 240_000, toMs: 300_000 }],
        },
      },
      { view: drawView },
    );
    const custom = view.within('region', 'Custom format');
    const back = posted(custom.get('button', 'Back to Freestyle'));
    assert({
      given: 'a Freestyle room whose prep was edited',
      should:
        'check Custom, say what it is based on, list the change and offer Back to the pinned standard',
      actual: {
        customChecked: checked(view, 'custom'),
        // Disabled controls are never posted: Custom is a status, not a choice.
        customNeverPosts: radios(view).some(
          (radio) => radio.value === 'custom' && radio.disabled,
        ),
        basedOn: custom.textContent().includes('Custom, based on Freestyle'),
        change: custom
          .all('listitem')
          .map((item) => item.textContent)
          .includes('Prep per side 4:00 → 5:00'),
        back: custom.has('button', 'Back to Freestyle'),
        reset: back.intent === 'reset',
        pinned: back.format === tuple('freestyle', 1),
      },
      expected: {
        customChecked: true,
        customNeverPosts: true,
        basedOn: true,
        change: true,
        back: true,
        reset: true,
        pinned: true,
      },
    });
  });

  test('a room started from a league template', () => {
    const view = render({
      name: unequalTemplate.label,
      role: 'template',
      leagues: unequalTemplate.leagues,
      basis: {
        formatId: unequalTemplate.formatId,
        name: unequalTemplate.label,
        formatVersion: unequalTemplate.formatVersion,
        presetVersion: unequalTemplate.preset.version,
        strikes: false,
      },
      standing: {
        kind: 'custom',
        basis: { formatId: unequalTemplate.formatId, role: 'template' },
        changes: [],
      },
    });
    assert({
      given: 'an unchanged league template',
      should:
        'read Custom, based on it, with no changes, and never offer Back for a template',
      actual: {
        basedOn: view
          .text('region', 'Custom format')
          .includes(`Custom, based on ${unequalTemplate.label}`),
        noChanges: view.text('region', 'Custom format').includes('No changes'),
        back: view.count('button', /^Back to/) > 0,
      },
      expected: { basedOn: true, noChanges: true, back: false },
    });
  });

  test('the league browser', () => {
    const view = render(freestyleStandard, { view: drawView });
    const select = view.within('combobox', 'Start from a league format');
    assert({
      given: 'a catalog with one league template',
      should:
        'offer it, grouped by family, as a native select that starts the room from it',
      actual: {
        group: select.has('group', 'League rules · Other formats'),
        option: select
          .all('option')
          .map((option) => (option as HTMLOptionElement).value)
          .includes(
            tuple(unequalTemplate.formatId, 5, unequalTemplate.formatVersion),
          ),
        submit: view.has('button', 'Start from this format'),
        standardsExcluded: !select
          .all('option')
          .some((option) =>
            (option as HTMLOptionElement).value.includes('freestyle'),
          ),
      },
      expected: {
        group: true,
        option: true,
        submit: true,
        standardsExcluded: true,
      },
    });
  });

  test('a room that strikes its resolution', () => {
    const view = render(freestyleStandard, { view: drawView });
    assert({
      given: 'a room running a draw',
      should: 'ask for host text only in the league template form',
      actual: [
        view.count('textbox', 'Resolution'),
        posted(view.get('button', 'Start from this format')).topic,
      ],
      expected: [1, ''],
    });
  });

  test('Back from a Custom draw to the standard', () => {
    const view = render(
      {
        ...freestyleStandard,
        standing: {
          kind: 'custom',
          basis: { formatId: 'freestyle', role: 'standard' },
          changes: [],
        },
      },
      { view: drawView },
    );
    assert({
      given: 'a Custom room based on Freestyle, still running a draw',
      should: 'go back to the striking standard without asking for host text',
      actual: [
        view.count('textbox', 'Resolution'),
        'topic' in posted(view.get('button', 'Back to Freestyle')),
      ],
      expected: [1, false],
    });
  });
});
