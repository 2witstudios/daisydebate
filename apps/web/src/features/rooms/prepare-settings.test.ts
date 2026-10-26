import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { prepareSettings } from './prepare-settings';

setupRitewayBun();
const settingsForm = () => {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    expectedVersion: '3',
    commandId: 'v'.repeat(24),
    'duration.countdown': '0:01',
    'duration.segment.N3': '1:30',
    'duration.segment.A1': '1:00',
    crossExMode: 'free',
    interruptionsMode: 'disabled',
    'duration.minRemaining': '0:02',
    yield: 'off',
  }))
    form.set(name, value);
  return form;
};

test('settings preserve the complete legal config and independent segment timing', () => {
  const result = prepareSettings(assemblySnapshot, settingsForm());
  assert({
    given: 'a host editing the declared N3 duration and declining preparation',
    should:
      'produce one canonical versioned config command without applying speech duration to every side',
    actual: result,
    expected: {
      kind: 'prepared',
      command: {
        type: 'update-config',
        commandId: 'v'.repeat(24),
        expectedVersion: 3,
        config: {
          preRoundPrep: { enabled: false },
          inRoundPrep: { enabled: false },
          speechTiming: {
            countdownMs: 1000,
            segmentDurationOverrides: { N3: 90000, A1: 60000 },
          },
          crossExamination: { crossExMode: 'free' },
          interruptions: { mode: 'disabled', minRemainingMs: 2000 },
          yielding: { allowed: false, returnsTime: true },
        },
      },
    },
  });
});

test('stale, out-of-bounds and non-host settings cannot become a prepared mutation', () => {
  const stale = settingsForm();
  stale.set('expectedVersion', '2');
  const illegal = settingsForm();
  illegal.set('duration.segment.N3', '15:00');
  const forged = settingsForm();
  forged.set('actorId', 'w'.repeat(24));
  const denied = {
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, canEdit: false },
  };
  assert({
    given:
      'stale intent, an illegal duration, an acting-principal injection and non-host projection',
    should: 'refuse all four without changing the source',
    actual: [
      prepareSettings(assemblySnapshot, stale).kind,
      prepareSettings(assemblySnapshot, illegal).kind,
      prepareSettings(assemblySnapshot, forged).kind,
      prepareSettings(denied, settingsForm()).kind,
      assemblySnapshot.config.speechTiming.segmentDurationOverrides.N3,
    ],
    expected: ['conflict', 'invalid', 'invalid', 'forbidden', 98765],
  });
});

test('duration bounds, duplicate fields and the old seconds grammar are refused', () => {
  const precision = settingsForm();
  precision.set('duration.segment.N3', '1:38.765');
  const tooShort = settingsForm();
  tooShort.set('duration.segment.N3', '0:59.999');
  const duplicate = settingsForm();
  duplicate.append('duration.segment.N3', '1:00');
  const old = settingsForm();
  old.set('seconds.N3', '98.765');
  const result = prepareSettings(assemblySnapshot, precision);
  assert({
    given:
      'exact legal precision and invalid combined or duplicate form values',
    should: 'keep the integer millisecond command and reject malformed forms',
    actual: [
      result.kind === 'prepared' && result.command.type === 'update-config'
        ? result.command.config.speechTiming.segmentDurationOverrides.N3
        : null,
      ...[tooShort, duplicate, old].map(
        (form) => prepareSettings(assemblySnapshot, form).kind,
      ),
    ],
    expected: [98765, 'invalid', 'invalid', 'invalid'],
  });
});

test('ending a speech early is one choice among those the format permits', () => {
  const permitted = {
    ...assemblySnapshot,
    definition: {
      ...assemblySnapshot.definition,
      configurable: {
        ...assemblySnapshot.definition.configurable,
        interaction: {
          ...assemblySnapshot.definition.configurable.interaction,
          yield: {
            enabledChoices: [true, false],
            returnsTimeChoices: [true, false],
          },
        },
      },
    },
  };
  const choose = (choice: string) => {
    const form = settingsForm();
    form.set('yield', choice);
    const result = prepareSettings(permitted, form);
    return result.kind === 'prepared' && result.command.type === 'update-config'
      ? result.command.config.yielding
      : result.kind;
  };
  assert({
    given: 'a format permitting every yield choice',
    should:
      'save off with the saved return choice, drop, return, and refuse an unknown choice',
    actual: ['off', 'drop', 'return', 'true'].map(choose),
    expected: [
      { allowed: false, returnsTime: true },
      { allowed: true, returnsTime: false },
      { allowed: true, returnsTime: true },
      'invalid',
    ],
  });
  assert({
    given: 'a format that forbids yielding',
    should: 'refuse a choice it does not offer',
    actual: prepareSettings(
      assemblySnapshot,
      (() => {
        const form = settingsForm();
        form.set('yield', 'drop');
        return form;
      })(),
    ).kind,
    expected: 'invalid',
  });
});
