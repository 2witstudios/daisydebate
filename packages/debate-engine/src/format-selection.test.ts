import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { oneOnOneSettings } from './runtime.test-support';
import {
  decideFormatSelection,
  type FormatSelectionFacts,
  type FormatSelectionRequest,
} from './format-selection';

setupRitewayBun();

const facts = (
  overrides: {
    readonly format?: Partial<FormatSelectionFacts['format']>;
    readonly preset?: Partial<FormatSelectionFacts['preset']>;
  } = {},
): FormatSelectionFacts => ({
  format: {
    id: 'value',
    name: 'Value',
    leagues: [],
    catalogOwned: true,
    role: 'standard',
    currentVersion: 1,
    ...overrides.format,
  },
  definition: oneOnOneFormatFixture,
  preset: {
    version: 3,
    formatVersion: 1,
    config: oneOnOneSettings,
    rankedEligible: false,
    current: true,
    ...overrides.preset,
  },
});

const request = (
  overrides: Partial<FormatSelectionRequest> = {},
): FormatSelectionRequest => ({
  intent: 'choose',
  formatId: 'value',
  formatVersion: 1,
  presetVersion: 3,
  basis: null,
  ...overrides,
});

const refusal = (
  given: string,
  req: FormatSelectionRequest,
  loaded: FormatSelectionFacts | null,
) => {
  const outcome = decideFormatSelection(req, loaded);
  return { given, refused: outcome.ok ? null : outcome.refusal };
};

describe('decideFormatSelection', () => {
  test('a new casual selection', () => {
    const outcome = decideFormatSelection(request(), facts());
    assert({
      given: 'the current, compiling preset of a catalog format with a role',
      should:
        'accept it with its definition, its preset config and the selection as the basis',
      actual: outcome.ok && {
        definition: outcome.definition,
        config: outcome.config,
        basis: outcome.basis,
        rankedPresetVersion: outcome.rankedPresetVersion,
        compiled: outcome.resolved.ok,
      },
      expected: {
        definition: oneOnOneFormatFixture,
        config: oneOnOneSettings,
        basis: { formatId: 'value', presetVersion: 3 },
        rankedPresetVersion: null,
        compiled: true,
      },
    });
    assert({
      given: 'an ineligible preset chosen for a casual room',
      should: 'accept it: eligibility only gates ranked play',
      actual: decideFormatSelection(
        request({ intent: 'create-casual' }),
        facts({ preset: { rankedEligible: false } }),
      ).ok,
      expected: true,
    });
  });

  test('new selections refuse what the picker does not offer', () => {
    assert({
      given: 'facts that cannot be relied on',
      should: 'refuse format-unavailable and never substitute another preset',
      actual: [
        refusal('an unknown format', request(), null),
        refusal(
          'a private custom format',
          request(),
          facts({ format: { catalogOwned: false, role: null } }),
        ),
        refusal(
          'a role-null catalog format',
          request(),
          facts({ format: { role: null } }),
        ),
        refusal(
          'a superseded preset (a stale form)',
          request(),
          facts({ preset: { current: false } }),
        ),
        refusal(
          'a definition revision behind the current pointer',
          request(),
          facts({ format: { currentVersion: 2 } }),
        ),
        refusal(
          'a preset pinned to another revision',
          request(),
          facts({ preset: { formatVersion: 2 } }),
        ),
        refusal(
          'a forged preset version',
          request({ presetVersion: 9 }),
          facts(),
        ),
        refusal('a forged format id', request({ formatId: 'policy' }), facts()),
      ],
      expected: [
        { given: 'an unknown format', refused: 'format-unavailable' },
        { given: 'a private custom format', refused: 'format-unavailable' },
        { given: 'a role-null catalog format', refused: 'format-unavailable' },
        {
          given: 'a superseded preset (a stale form)',
          refused: 'format-unavailable',
        },
        {
          given: 'a definition revision behind the current pointer',
          refused: 'format-unavailable',
        },
        {
          given: 'a preset pinned to another revision',
          refused: 'format-unavailable',
        },
        { given: 'a forged preset version', refused: 'format-unavailable' },
        { given: 'a forged format id', refused: 'format-unavailable' },
      ],
    });
  });

  test('ranked admission is separate from picker visibility', () => {
    const ranked = request({
      intent: 'create-ranked',
      formatId: 'one-on-one',
    });
    const oneOnOne = facts({
      format: { id: 'one-on-one', role: null },
      preset: { rankedEligible: true },
    });
    const outcome = decideFormatSelection(ranked, oneOnOne);
    assert({
      given:
        'the eligible current preset of a catalog-owned, role-null 1/1/1 format',
      should: 'admit ranked play and pin the preset, with no basis',
      actual: outcome.ok && {
        basis: outcome.basis,
        rankedPresetVersion: outcome.rankedPresetVersion,
      },
      expected: { basis: null, rankedPresetVersion: 3 },
    });
    assert({
      given: 'ranked requests ranked admission cannot accept',
      should: 'refuse each one',
      actual: [
        refusal(
          'an ineligible preset',
          ranked,
          facts({
            format: { id: 'one-on-one', role: null },
            preset: { rankedEligible: false },
          }),
        ),
        refusal(
          'a private format',
          ranked,
          facts({
            format: { id: 'one-on-one', catalogOwned: false, role: null },
            preset: { rankedEligible: true },
          }),
        ),
        refusal('a two-a-side format', ranked, {
          ...oneOnOne,
          definition: {
            ...oneOnOneFormatFixture,
            seats: { affirmative: 2, negative: 2, judge: 1 },
          },
        }),
        refusal('a superseded preset', ranked, {
          ...oneOnOne,
          preset: { ...oneOnOne.preset, current: false },
        }),
      ],
      expected: [
        { given: 'an ineligible preset', refused: 'format-unavailable' },
        { given: 'a private format', refused: 'format-unavailable' },
        { given: 'a two-a-side format', refused: 'format-unavailable' },
        { given: 'a superseded preset', refused: 'format-unavailable' },
      ],
    });
  });

  test('reset restores the pinned basis', () => {
    const reset = request({
      intent: 'reset',
      basis: { formatId: 'value', presetVersion: 3 },
    });
    assert({
      given:
        'the room’s exact basis after a newer preset was published and the format left the picker',
      should: 'restore that pinned preset',
      actual: decideFormatSelection(
        reset,
        facts({
          format: { role: null, currentVersion: 2 },
          preset: { current: false },
        }),
      ).ok,
      expected: true,
    });
    assert({
      given: 'a reset that does not name the room’s own basis',
      should: 'refuse it',
      actual: [
        refusal('no basis', request({ intent: 'reset' }), facts()),
        refusal(
          'another preset of the same format',
          { ...reset, presetVersion: 2 },
          facts({ preset: { version: 2 } }),
        ),
        refusal(
          'a basis that is no longer catalog-owned',
          reset,
          facts({ format: { catalogOwned: false } }),
        ),
      ],
      expected: [
        { given: 'no basis', refused: 'format-unavailable' },
        {
          given: 'another preset of the same format',
          refused: 'format-unavailable',
        },
        {
          given: 'a basis that is no longer catalog-owned',
          refused: 'format-unavailable',
        },
      ],
    });
  });

  test('a preset that does not compile', () => {
    assert({
      given: 'a current preset its definition refuses',
      should: 'refuse illegal-config',
      actual: refusal(
        'a broken preset',
        request(),
        facts({
          preset: {
            config: {
              ...oneOnOneSettings,
              speechTiming: {
                ...oneOnOneSettings.speechTiming,
                segmentDurationOverrides: { NOPE: 60_000 },
              },
            },
          },
        }),
      ),
      expected: { given: 'a broken preset', refused: 'illegal-config' },
    });
  });
});
