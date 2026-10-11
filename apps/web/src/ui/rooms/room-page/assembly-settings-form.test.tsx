import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblySettingsFields } from './assembly-settings-form';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { formatDefinitionSchema } from '@daisy/protocol';
import { prepareSettings } from '../../../features/rooms/prepare-settings';

setupRitewayBun();

test('legal speech keys cannot collide with ancillary native duration fields', () => {
  const keys = ['budget', 'preRound'];
  const definition = {
    ...assemblySnapshot.definition,
    segments: assemblySnapshot.definition.segments.map((segment, index) => ({
      ...segment,
      key: keys[index]!,
    })),
    configurable: {
      ...assemblySnapshot.definition.configurable,
      timing: {
        ...assemblySnapshot.definition.configurable.timing,
        segmentDurationMs: Object.fromEntries(
          keys.map((key) => [key, { min: 60000, max: 180000 }]),
        ),
      },
    },
  };
  const config = {
    ...assemblySnapshot.config,
    speechTiming: {
      ...assemblySnapshot.config.speechTiming,
      segmentDurationOverrides: { budget: 98765, preRound: 60000 },
    },
  };
  const resolved = resolveRoomConfiguration(definition, config);
  if (!resolved.ok)
    throw new Error('Collision regression fixture must compile');
  const view = {
    ...assemblySnapshot,
    definition,
    config,
    rules: resolved.rules,
    executionPlan: resolved.roomPlan,
  };
  const html = renderToStaticMarkup(
    <AssemblySettingsFields
      view={view}
      commandId={'v'.repeat(24)}
      state={{ values: {} }}
      pending={false}
    />,
  );
  const form = new FormData();
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const name = tag.match(/name="([^"]*)"/)?.[1];
    const value = tag.match(/value="([^"]*)"/)?.[1];
    if (name && value !== undefined) form.append(name, value);
    if (name && tag.includes('checked=""')) form.append(name, 'on');
  }
  for (const [name, value] of Object.entries({
    crossExMode: 'free',
    interruptionsMode: 'disabled',
    yieldAllowed: 'false',
    yieldReturns: 'true',
  }))
    form.set(name, value);
  const result = prepareSettings(view, form);
  form.append('duration.segment.budget.minutes', '1');
  assert({
    given:
      'a valid pinned definition with budget and preRound speech keys and enabled ancillary preparation',
    should:
      'render unique native names, save unchanged exact independent values and still refuse duplicate speech components',
    actual: [
      formatDefinitionSchema.safeParse(definition).success,
      [...form.keys()].filter((name) => name === 'duration.budget.minutes')
        .length,
      result.kind === 'prepared' && result.command.type === 'update-config'
        ? result.command.config
        : null,
      prepareSettings(view, form).kind,
    ],
    expected: [true, 1, config, 'invalid'],
  });
});

test('settings use the exact persisted sequence and capability-specific controls', () => {
  const html = renderToStaticMarkup(
    <AssemblySettingsFields
      view={assemblySnapshot}
      commandId="settings-command"
      state={{ values: {} }}
      pending={false}
    />,
  );
  assert({
    given:
      'an unequal template with independent prep, timing and interaction capabilities',
    should:
      'render every declared config control and a slot-specific speech rather than one shared speech length',
    actual: [
      html.includes('name="duration.segment.N3.minutes"'),
      html.includes('value="38.765"'),
      html.includes('Negative 3'),
      [
        'preRoundPrep',
        'duration.preRound.minutes',
        'inRoundPrep',
        'duration.budget.seconds',
        'duration.countdown.seconds',
        'crossExMode',
        'interruptionsMode',
        'duration.minRemaining.seconds',
        'yieldAllowed',
        'yieldReturns',
      ].every((name) => html.includes(`name="${name}"`)),
      html.includes('Save settings'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('refused settings preserve typed fields and the stale version until explicit reread', () => {
  const html = renderToStaticMarkup(
    <AssemblySettingsFields
      view={{ ...assemblySnapshot, version: 4 }}
      commandId="new-command"
      state={{
        values: {
          expectedVersion: '3',
          commandId: 'old-command',
          'duration.segment.N3.minutes': '02',
          'duration.segment.N3.seconds': '03.456',
        },
        error: 'The room changed.',
      }}
      pending={false}
    />,
  );
  assert({
    given: 'a refused draft at version three and a fresh view at four',
    should:
      'preserve the submitted duration/fence/command and provide an explicit latest-room recovery',
    actual: [
      html.includes('value="03.456"'),
      html.includes('name="expectedVersion" value="3"'),
      html.includes('old-command'),
      html.includes('The room changed.'),
      html.includes('Review latest room'),
    ],
    expected: [true, true, true, true, true],
  });
});
