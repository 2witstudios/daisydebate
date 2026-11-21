import { renderToStaticMarkup } from 'react-dom/server';
import { idle } from '../../../features/forms/form-state';
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
    const html = render(freestyleStandard, { view: drawView });
    assert({
      given: 'a casual room still running the Freestyle standard',
      should:
        'offer Freestyle plus Custom, check Freestyle, and post select-format before hydration',
      actual: {
        order: [
          ...html.matchAll(
            /<span class="[^"]*font-strong[^"]*">(Freestyle|Custom)</g,
          ),
        ].map((match) => match[1]),
        freestyleChecked: checked(html, tuple('freestyle', 1)),
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
    const html = render(
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
    assert({
      given: 'a Freestyle room whose prep was edited',
      should:
        'check Custom, say what it is based on, list the change and offer Back to the pinned standard',
      actual: {
        customChecked: checked(html, 'custom'),
        // Disabled controls are never posted: Custom is a status, not a choice.
        customNeverPosts: (html.match(/<input [^>]*>/g) ?? []).some(
          (input) =>
            input.includes('value="custom"') && input.includes('disabled=""'),
        ),
        basedOn: html.includes('Custom, based on Freestyle'),
        change: html.includes('Prep per side 4:00 → 5:00'),
        back: html.includes('Back to Freestyle'),
        reset: html.includes('name="intent" value="reset"'),
        pinned: html.includes(`value="${tuple('freestyle', 1)}"`),
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
    const html = render(freestyleStandard, { view: drawView });
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
        standardsExcluded: !/<option value="[^"]*freestyle/.test(html),
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
    const html = render(freestyleStandard, { view: drawView });
    assert({
      given: 'a room running a draw',
      should: 'ask for host text only in the league template form',
      actual: html.match(/name="topic"/g)?.length,
      expected: 1,
    });
  });

  test('Back from a Custom draw to the standard', () => {
    const html = render(
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
      actual: html.match(/name="topic"/g)?.length,
      expected: 1,
    });
  });
});
