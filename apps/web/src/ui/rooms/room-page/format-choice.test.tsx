import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomCatalogChoice, RoomView } from '@daisy/protocol';
import {
  assemblySnapshot,
  unequalTemplate,
} from '../../../features/rooms/assembly.test-support';
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
const choices: readonly RoomCatalogChoice[] = [
  unequalTemplate,
  standard('value', 'Value', 2),
  standard('policy', 'Policy', 1),
];
const ids = {
  choose: 'c'.repeat(24),
  reset: 'r'.repeat(24),
  template: 't'.repeat(24),
};
const action = async () => ({ values: {} });

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
    version: 1,
    config: { ...unequalTemplate.preset.config, resolutionDraw: strike },
  },
};

const render = (
  format: RoomView['format'],
  options: {
    readonly catalog?: readonly RoomCatalogChoice[];
    readonly view?: Partial<RoomView>;
  } = {},
) =>
  renderToStaticMarkup(
    <FormatChoice
      view={{ ...assemblySnapshot, format, ...options.view }}
      choices={options.catalog ?? choices}
      ids={ids}
      action={action}
    />,
  );
const tuple = (formatId: string, presetVersion: number, formatVersion = 1) =>
  JSON.stringify({ formatId, formatVersion, presetVersion }).replaceAll(
    '"',
    '&quot;',
  );

/** Whether the radio with this rendered value is checked, whatever the attribute order. */
const checked = (html: string, value: string) =>
  (html.match(/<input [^>]*>/g) ?? []).some(
    (input) =>
      input.includes(`value="${value}"`) && input.includes('checked=""'),
  );

const valueStandard: RoomView['format'] = {
  name: 'Value',
  role: 'standard',
  leagues: [],
  basis: {
    formatId: 'value',
    name: 'Value',
    formatVersion: 1,
    presetVersion: 2,
    strikes: false,
  },
  standing: { kind: 'standard', formatId: 'value' },
};

describe('FormatChoice', () => {
  test('a room on a standard', () => {
    const html = render(valueStandard);
    assert({
      given: 'a casual room still running the Value standard',
      should:
        'offer the standards in catalog order plus Custom, check Value, and post select-format without JavaScript',
      actual: {
        order: [
          ...html.matchAll(
            /<span class="[^"]*font-strong[^"]*">(Policy|Value|Custom)</g,
          ),
        ].map((match) => match[1]),
        valueChecked: checked(html, tuple('value', 2)),
        policyOffered: html.includes(`value="${tuple('policy', 2)}"`),
        command: html.includes('name="type" value="select-format"'),
        intent: html.includes('name="intent" value="choose"'),
        submit: html.includes('Use this format'),
        templateNotAStandard: checked(
          html,
          tuple(unequalTemplate.formatId, 5, unequalTemplate.formatVersion),
        ),
        backOffered: html.includes('Back to'),
      },
      expected: {
        order: ['Policy', 'Value', 'Custom'],
        valueChecked: true,
        policyOffered: true,
        command: true,
        intent: true,
        submit: true,
        templateNotAStandard: false,
        backOffered: false,
      },
    });
  });

  test('a room edited away from its standard', () => {
    const html = render({
      ...valueStandard,
      standing: {
        kind: 'custom',
        basis: { formatId: 'value', role: 'standard' },
        changes: [{ kind: 'in-round-prep', fromMs: 240_000, toMs: 300_000 }],
      },
    });
    assert({
      given: 'a standard room whose prep was edited',
      should:
        'check Custom, say what it is based on, list the change and offer Back to the pinned standard',
      actual: {
        customChecked: checked(html, 'custom'),
        // Disabled controls are never posted: Custom is a status, not a choice.
        customNeverPosts: (html.match(/<input [^>]*>/g) ?? []).some(
          (input) =>
            input.includes('value="custom"') && input.includes('disabled=""'),
        ),
        basedOn: html.includes('Custom, based on Value'),
        change: html.includes('Prep per side 4:00 → 5:00'),
        back: html.includes('Back to Value'),
        reset: html.includes('name="intent" value="reset"'),
        pinned: html.includes(`value="${tuple('value', 2)}"`),
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
    const html = render({
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
        basedOn: html.includes(`Custom, based on ${unequalTemplate.label}`),
        noChanges: html.includes('No changes'),
        back: html.includes('Back to'),
      },
      expected: { basedOn: true, noChanges: true, back: false },
    });
  });

  test('the league browser', () => {
    const html = render(valueStandard);
    assert({
      given: 'a catalog with one league template',
      should:
        'offer it, grouped by family, as a native select that starts the room from it',
      actual: {
        group: html.includes('<optgroup label="League rules · Other formats">'),
        option: html.includes(
          `value="${tuple(unequalTemplate.formatId, 5, unequalTemplate.formatVersion)}"`,
        ),
        submit: html.includes('Start from this format'),
        standardsExcluded: !/<option value="[^"]*policy/.test(html),
      },
      expected: {
        group: true,
        option: true,
        submit: true,
        standardsExcluded: true,
      },
    });
  });

  test('Freestyle joins the standards (FMT-2b)', () => {
    const standards = (html: string) =>
      [
        ...html.matchAll(
          /<span class="[^"]*font-strong[^"]*">(Policy|Value|Freestyle|Custom)</g,
        ),
      ].map((match) => match[1]);
    assert({
      given: 'the catalog before and after Freestyle is published',
      should: 'leave it out, then offer it third among the standards',
      actual: [
        standards(render(valueStandard)),
        standards(render(valueStandard, { catalog: [...choices, freestyle] })),
      ],
      expected: [
        ['Policy', 'Value', 'Custom'],
        ['Policy', 'Value', 'Freestyle', 'Custom'],
      ],
    });
  });

  test('a room that strikes its resolution', () => {
    const html = render(
      {
        ...valueStandard,
        name: 'Freestyle',
        basis: {
          ...valueStandard.basis!,
          formatId: 'freestyle',
          name: 'Freestyle',
        },
        standing: { kind: 'standard', formatId: 'freestyle' },
      },
      {
        catalog: [...choices, freestyle],
        view: {
          topic: null,
          executionPlan: {
            ...assemblySnapshot.executionPlan,
            resolutionDraw: strike,
          },
        },
      },
    );
    assert({
      given: 'a room running a draw',
      should:
        'ask for the resolution a set-resolution format needs, in the standards and league forms',
      actual: html.match(/name="topic"/g)?.length,
      expected: 2,
    });
  });

  test('Back from a draw to a standard that sets its resolution', () => {
    const fields = (strikes: boolean) =>
      render(
        {
          ...valueStandard,
          basis: { ...valueStandard.basis!, strikes },
          standing: {
            kind: 'custom',
            basis: { formatId: 'value', role: 'standard' },
            changes: [],
          },
        },
        {
          view: {
            topic: null,
            executionPlan: {
              ...assemblySnapshot.executionPlan,
              resolutionDraw: strike,
            },
          },
        },
      ).match(/name="topic"/g)?.length;
    assert({
      given:
        'a Value room whose host turned a strike on, and a room whose pinned basis itself strikes',
      should:
        'ask Back for the resolution only when the pinned basis sets one, whatever the catalog now offers',
      actual: [fields(false), fields(true)],
      expected: [3, 2],
    });
  });
});
