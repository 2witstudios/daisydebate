import { assert, setupRitewayBun, test } from 'riteway/bun';
import { oneOnOneDefinition, oneOnOneSettings } from './runtime.test-support';
import { resolveRoomConfiguration } from './resolve-room-configuration';
setupRitewayBun();

const custom = (durationMs: number) => ({
  ...oneOnOneDefinition,
  segments: oneOnOneDefinition.segments.map((segment) =>
    segment.key === 'AC'
      ? { ...segment, defaultDurationMs: durationMs }
      : segment,
  ),
  configurable: {
    ...oneOnOneDefinition.configurable,
    timing: {
      ...oneOnOneDefinition.configurable.timing,
      segmentDurationMs: {
        ...oneOnOneDefinition.configurable.timing.segmentDurationMs,
        AC: { min: 1, max: 600000 },
      },
    },
  },
});
test('custom actual speech duration must cover the forty-second attendance grace', () => {
  for (const duration of [39999, 40000, 75000]) {
    const resolved = resolveRoomConfiguration(
      custom(duration),
      oneOnOneSettings,
    );
    assert({
      given: `custom speech default ${duration}ms`,
      should: 'refuse below grace and preserve legal durations exactly',
      actual: resolved.ok
        ? resolved.rules.segments[0]?.durationMs
        : resolved.refusal.kind,
      expected: duration < 40000 ? 'out-of-range' : duration,
    });
    const overridden = resolveRoomConfiguration(custom(75000), {
      ...oneOnOneSettings,
      speechTiming: {
        ...oneOnOneSettings.speechTiming,
        segmentDurationOverrides: { AC: duration },
      },
    });
    assert({
      given: `custom speech override ${duration}ms within declared bounds`,
      should: 'apply the same grace minimum without truncation',
      actual: overridden.ok
        ? overridden.rules.segments[0]?.durationMs
        : overridden.refusal.kind,
      expected: duration < 40000 ? 'out-of-range' : duration,
    });
  }
});
test('interaction-only durations remain independent of speech attendance grace', () => {
  const definition = {
    ...oneOnOneDefinition,
    segments: oneOnOneDefinition.segments.map((s) =>
      s.type === 'cross_ex' ? { ...s, defaultDurationMs: 1000 } : s,
    ),
    configurable: {
      ...oneOnOneDefinition.configurable,
      timing: {
        ...oneOnOneDefinition.configurable.timing,
        segmentDurationMs: {
          ...oneOnOneDefinition.configurable.timing.segmentDurationMs,
          CX1: { min: 1, max: 120000 },
          CX2: { min: 1, max: 120000 },
        },
      },
    },
  };
  const result = resolveRoomConfiguration(definition, oneOnOneSettings);
  assert({
    given: 'one-second CX intervals',
    should: 'preserve valid CX without imposing speech grace',
    actual:
      result.ok &&
      result.rules.segments
        .filter((s) => s.type === 'cross_ex')
        .map((s) => s.durationMs),
    expected: [1000, 1000],
  });
});
