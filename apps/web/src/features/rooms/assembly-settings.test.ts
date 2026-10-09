import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySpeechSettings } from './assembly-settings';

setupRitewayBun();

test('canonical settings preserve team slots, per-segment bounds and saved overrides', () => {
  const segments = [
    {
      key: 'A2',
      label: 'Second affirmative',
      side: 'affirmative' as const,
      slot: 1,
      type: 'speech' as const,
      defaultDurationMs: 240000,
    },
    {
      key: 'N3',
      label: 'Third negative',
      side: 'negative' as const,
      slot: 2,
      type: 'speech' as const,
      defaultDurationMs: 180000,
    },
  ];
  const acceptsSequence = (keys: readonly string[]) => keys.length > 0;
  const result = assemblySpeechSettings(
    {
      definition: {
        segments,
        configurable: {
          timing: {
            segmentDurationMs: {
              A2: { min: 60000, max: 300000 },
              N3: { min: 30000, max: 240000 },
            },
          },
        },
      },
      rules: {
        segments: segments.map(
          ({ defaultDurationMs: _default, ...segment }) => ({
            ...segment,
            durationMs: segment.key === 'A2' ? 120000 : 180000,
          }),
        ),
      },
    },
    { canEditSequence: false, acceptsSequence },
  );
  assert({
    given:
      'an authoritative format and saved rules containing a timing override',
    should:
      'derive controls without global speech limits or replacing saved durations with defaults',
    actual: [
      result.saved,
      result.controls.segments.map(({ slot, minDurationMs, maxDurationMs }) => [
        slot,
        minDurationMs,
        maxDurationMs,
      ]),
      result.controls.canEditSequence,
      result.controls.acceptsSequence === acceptsSequence,
    ],
    expected: [
      { sequence: ['A2', 'N3'], durationsMs: { A2: 120000, N3: 180000 } },
      [
        [1, 60000, 300000],
        [2, 30000, 240000],
      ],
      false,
      true,
    ],
  });
});
