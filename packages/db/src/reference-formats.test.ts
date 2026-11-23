import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  formatDefinitionSchema,
  type FormatDefinition,
} from '@daisy/protocol/format';
import { formatSettingsSchema } from '@daisy/protocol/format-settings';
import { oneOnOneSettingsFixture } from '@daisy/protocol/testing';
import {
  oneOnOneSettings,
  referenceFormats,
  referencePresets,
} from './reference-formats';

setupRitewayBun();

/** The newest approved revision per format: the one ranked play resolves. */
const currentReferencePresets = () =>
  referencePresets.filter(
    (preset) =>
      !referencePresets.some(
        (later) =>
          later.formatId === preset.formatId && later.version > preset.version,
      ),
  );

describe('reference data', () => {
  test("one-on-one's settings are the engine's fixture, never a drifting copy", () => {
    assert({
      given:
        "the reference one-on-one settings and the protocol's shared fixture",
      should: 'be equal, so the engine and db tests exercise the same defaults',
      actual: oneOnOneSettings,
      expected: oneOnOneSettingsFixture,
    });
  });

  test('one-on-one follows the standard one-on-one schedule in its second revision (DEC-234)', () => {
    const oneOnOne = referenceFormats.find(({ id }) => id === 'one-on-one');
    const defaults = (definition: FormatDefinition | undefined) =>
      Object.fromEntries(
        (definition?.segments ?? []).map((segment) => [
          segment.key,
          segment.defaultDurationMs,
        ]),
      );
    assert({
      given: 'the one-on-one revision history',
      should:
        'keep revision 1 as published and default the 1AR to 3:00 in revision 2, every other segment unchanged',
      actual: {
        revisions: oneOnOne?.revisions.length,
        first: defaults(oneOnOne?.revisions[0]),
        current: defaults(oneOnOne?.definition),
      },
      expected: {
        revisions: 2,
        first: {
          AC: 300_000,
          CX1: 120_000,
          NC: 360_000,
          CX2: 120_000,
          '1AR': 300_000,
          NR: 300_000,
          '2AR': 180_000,
        },
        current: {
          AC: 300_000,
          CX1: 120_000,
          NC: 360_000,
          CX2: 120_000,
          '1AR': 180_000,
          NR: 300_000,
          '2AR': 180_000,
        },
      },
    });
  });

  test('ranked play resolves against the current revision', () => {
    assert({
      given: 'the newest approved preset per format and length',
      should: "pin each to its format's current definition revision",
      actual: currentReferencePresets().map(({ formatId, formatVersion }) => [
        formatId,
        formatVersion,
      ]),
      expected: currentReferencePresets().map(({ formatId }) => [
        formatId,
        referenceFormats.find(({ id }) => id === formatId)?.revisions.length,
      ]),
    });
  });

  test('every reference definition and preset passes the protocol schemas', () => {
    assert({
      given: 'all reference formats and presets',
      should:
        'each validate as a format definition and as format settings, never a Room config (ISSUE-775)',
      actual: {
        definitions: referenceFormats.flatMap(({ revisions }) =>
          revisions.map(
            (definition) =>
              formatDefinitionSchema.safeParse(definition).success,
          ),
        ),
        configs: referencePresets.map(
          ({ config }) => formatSettingsSchema.safeParse(config).success,
        ),
      },
      expected: {
        definitions: referenceFormats.flatMap(({ revisions }) =>
          revisions.map(() => true),
        ),
        configs: referencePresets.map(() => true),
      },
    });
  });

  test('the foundation format stays unjudged and unranked', () => {
    const foundation = referenceFormats.find(
      (format) => format.id === 'foundation',
    );
    assert({
      given: 'the foundation reference format',
      should:
        'offer no judge seat and hold no preset, so it never reaches a ladder',
      actual: {
        judge: foundation?.definition.seats.judges,
        presets: referencePresets.filter(
          ({ formatId }) => formatId === 'foundation',
        ).length,
      },
      expected: { judge: 0, presets: 0 },
    });
  });
});
