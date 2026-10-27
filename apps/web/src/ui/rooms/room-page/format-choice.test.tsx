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

const render = (format: RoomView['format']) =>
  renderToStaticMarkup(
    <FormatChoice
      view={{ ...assemblySnapshot, format }}
      choices={choices}
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
        basedOn: html.includes('Custom, based on Value'),
        change: html.includes('Prep per side 4:00 → 5:00'),
        back: html.includes('Back to Value'),
        reset: html.includes('name="intent" value="reset"'),
        pinned: html.includes(`value="${tuple('value', 2)}"`),
      },
      expected: {
        customChecked: true,
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
        group: html.includes('<optgroup label="Other formats">'),
        option: html.includes(
          `<option value="${tuple(unequalTemplate.formatId, 5, unequalTemplate.formatVersion)}">`,
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
});
