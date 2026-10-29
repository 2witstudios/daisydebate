import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { unequalTemplate } from './assembly.test-support';
import { createRoomDraft } from './create-room-draft';
import { draftFormValues, readRoomDraft } from './create-room-fields';

setupRitewayBun();
const choice = () => ({
  ...unequalTemplate,
  formatId: 'value',
  role: 'standard' as const,
});

describe('native room draft fields', () => {
  test('exact round trip', () => {
    const draft = createRoomDraft(choice());
    const read = readRoomDraft(draftFormValues(draft), [choice()]);
    assert({
      given:
        'a native form containing a standard with unequal seats and fractional durations',
      should: 'preserve all settings without silently making it Custom',
      actual: read.ok && [
        read.draft.custom,
        read.draft.definition.segments,
        read.draft.config,
      ],
      expected: [false, draft.definition.segments, draft.config],
    });
  });
  test('native edits are authoritative inputs', () => {
    const fields = draftFormValues(createRoomDraft(choice()));
    const read = readRoomDraft(
      { ...fields, 'duration.preRound': '0:00', ranked: 'on' },
      [choice()],
    );
    assert({
      given:
        'changed prep submitted without JavaScript while Ranked is checked',
      should: 'keep the edit and make Custom unranked',
      actual: read.ok && [
        read.draft.custom,
        read.draft.ranked,
        read.draft.config.preRoundPrep,
      ],
      expected: [true, false, { enabled: false }],
    });
  });
  test('malformed timings', () => {
    const fields = draftFormValues(createRoomDraft(choice()));
    assert({
      given: 'a negative duration or malformed seconds',
      should: 'refuse before sending a create command',
      actual: ['-1:00', '1:99'].map(
        (duration) =>
          readRoomDraft({ ...fields, 'duration.segment.0': duration }, [
            choice(),
          ]).ok,
      ),
      expected: [false, false],
    });
  });
  test('Custom supports structural edits and POI independent of template capabilities', () => {
    const fields = draftFormValues(createRoomDraft(choice()));
    const read = readRoomDraft(
      {
        ...fields,
        format: 'custom',
        segmentCount: '3',
        'segment.2.key': 'extra',
        'segment.2.label': 'Additional reply',
        'segment.2.type': 'speech',
        'segment.2.side': 'affirmative',
        'segment.2.slot': '0',
        'duration.segment.2': '2:00',
        questionStyle: 'poi',
        resolutionMethod: 'strike',
      },
      [choice()],
    );
    assert({
      given:
        'a template that forbids strike and interruptions, customized with a speech and POI',
      should:
        'compile a separate Custom definition supporting the requested rules',
      actual: read.ok && [
        read.draft.custom,
        read.draft.definition.segments.length,
        read.draft.definition.configurable.resolutionDraw !== null,
        read.draft.config.interruptions?.mode,
      ],
      expected: [true, 3, true, 'open'],
    });
  });
});

test('database JSON key order cannot customize an untouched standard', () => {
  const source = choice();
  const reordered = {
    ...source,
    definition: {
      ...source.definition,
      configurable: {
        ...source.definition.configurable,
        timing: {
          ...source.definition.configurable.timing,
          segmentDurationMs: Object.fromEntries(
            Object.entries(
              source.definition.configurable.timing.segmentDurationMs,
            ).reverse(),
          ),
        },
      },
    },
  };
  const read = readRoomDraft(draftFormValues(createRoomDraft(reordered)), [
    reordered,
  ]);
  assert({
    given:
      'a standard returned from JSONB with timing keys in a different order',
    should: 'remain Standard and eligible for Ranked until a rule changes',
    actual: read.ok && read.draft.custom,
    expected: false,
  });
});

test('native standard switching never carries a checked Ranked flag into the replacement preset', () => {
  const source = choice();
  const policy = { ...source, formatId: 'policy' };
  const fields = {
    ...draftFormValues(createRoomDraft(source)),
    format: 'policy',
    ranked: 'on',
  };
  const read = readRoomDraft(fields, [source, policy]);
  assert({
    given: 'a checked Ranked flag posted with a different standard',
    should:
      'restore that standard while leaving Ranked off, as the enhanced editor does',
    actual: read.ok && [
      read.draft.basis.formatId,
      read.draft.ranked,
      read.draft.resolutionMethod,
    ],
    expected: ['policy', false, 'policy'],
  });
});
