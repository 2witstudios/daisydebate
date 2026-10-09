import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { prepareSettings } from './prepare-settings';

setupRitewayBun();
const settingsForm = () => {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    expectedVersion: '3',
    commandId: 'v'.repeat(24),
    countdown: '1',
    'seconds.N3': '90',
    crossExMode: 'free',
    interruptionsMode: 'disabled',
    minRemaining: '2',
    yieldAllowed: 'false',
    yieldReturns: 'true',
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
            segmentDurationOverrides: { N3: 90000 },
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
  illegal.set('seconds.N3', '900');
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
