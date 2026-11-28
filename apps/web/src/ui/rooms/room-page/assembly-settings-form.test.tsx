import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import type { ComponentProps } from 'react';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { AssemblySettingsFields } from './assembly-settings-form';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { formatDefinitionSchema } from '@daisy/protocol/format';
import {
  freezeRoomConfig,
  freezeRoomExecutionPlan,
  type RoomConfig,
} from '@daisy/protocol/room';
import { prepareSettings } from '../../../features/rooms/prepare-settings';
import { saveSettings } from '../../../features/rooms/save-settings';
import {
  commandUnavailable,
  roomAccepted,
  roomEditFields,
} from '../../../features/rooms/command-answer';
import type { FormFields } from '../../../features/forms/form-state';

setupRitewayBun();

/** The settings fields, server-rendered inside a named form, read by role. */
const renderFields = (props: ComponentProps<typeof AssemblySettingsFields>) => {
  const view = renderAccessible(
    <form action="/test-form" method="post" aria-label="Round settings">
      <AssemblySettingsFields {...props} />
    </form>,
  );
  return { view, form: view.get('form', 'Round settings') };
};

/** The native inputs' rendered name and value attributes, as the server render carries them. */
function nativeInputFields(element: Element) {
  const form = new FormData();
  for (const input of element.querySelectorAll('input')) {
    const name = input.getAttribute('name');
    const value = input.getAttribute('value');
    if (name && value !== null) form.append(name, value);
    if (name && input.hasAttribute('checked')) form.append(name, 'on');
  }
  return form;
}

/** The one input posted under this name. */
const field = (form: Element, name: string) =>
  form.querySelector(`[name="${name}"]`) as HTMLInputElement | null;

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
  const config: RoomConfig = {
    ...assemblySnapshot.config,
    resolutionDraw: { enabled: false },
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
    config: freezeRoomConfig(config),
    rules: resolved.rules,
    executionPlan: freezeRoomExecutionPlan(resolved.roomPlan),
  };
  const rendered = renderFields({
    view,
    commandId: 'v'.repeat(24),
    state: { values: {}, error: undefined },
    pending: false,
  });
  const form = nativeInputFields(rendered.form);
  form.set('yield', 'off');
  const result = prepareSettings(view, form);
  form.append('duration.segment.budget', '1:00');
  assert({
    given:
      'a valid pinned definition with budget and preRound speech keys and enabled ancillary preparation',
    should:
      'render unique native names, save unchanged exact independent values and still refuse duplicate speech components',
    actual: [
      formatDefinitionSchema.safeParse(definition).success,
      [...form.keys()].filter((name) => name === 'duration.budget').length,
      result.kind === 'prepared' && result.command.type === 'update-config'
        ? result.command.config
        : null,
      prepareSettings(view, form).kind,
    ],
    expected: [true, 1, config, 'invalid'],
  });
});

test('settings use the exact persisted sequence and capability-specific controls', () => {
  const { view, form } = renderFields({
    view: assemblySnapshot,
    commandId: 'settings-command',
    state: { values: {}, error: undefined },
    pending: false,
  });
  assert({
    given:
      'an unequal template with independent prep, timing and interaction capabilities',
    should:
      'render every declared config control and a slot-specific speech rather than one shared speech length',
    actual: [
      field(form, 'duration.segment.N3') !== null,
      field(form, 'duration.segment.N3')?.value === '1:38.765',
      view.textContent().includes('Negative 3'),
      [
        'preRoundPrep',
        'duration.preRound',
        'inRoundPrep',
        'duration.budget',
        'duration.countdown',
        'pointsOfInformation',
        'duration.poi.start',
        'duration.poi.end',
        'duration.poi.length',
        'duration.poi.lapse',
        'yield',
      ].every((name) => field(form, name) !== null),
      view.has('button', 'Save round settings'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('refused settings preserve typed fields and the stale version until explicit reread', () => {
  const { view, form } = renderFields({
    view: { ...assemblySnapshot, version: 4 },
    commandId: 'new-command',
    state: {
      values: {
        expectedVersion: '3',
        commandId: 'old-command',
        'duration.segment.N3': '2:03.456',
      },
      error: 'The room changed.',
    },
    pending: false,
  });
  assert({
    given: 'a refused draft at version three and a fresh view at four',
    should:
      'preserve the submitted duration/fence/command and provide an explicit latest-room recovery',
    actual: [
      field(form, 'duration.segment.N3')?.value,
      field(form, 'expectedVersion')?.value,
      field(form, 'commandId')?.value,
      view.text('alert'),
      view.attribute('link', 'Review latest room', 'href'),
    ],
    expected: [
      '2:03.456',
      '3',
      'old-command',
      'The room changed.',
      `/rooms/${assemblySnapshot.id}`,
    ],
  });
});

test('the basics come first and the full rules sit behind one disclosure', () => {
  const { view, form } = renderFields({
    view: assemblySnapshot,
    commandId: 'settings-command',
    state: { values: {}, error: undefined },
    pending: false,
  });
  const text = view.textContent();
  const disclosure = text.indexOf('Customize speeches and rules');
  const details = view
    .all('group', undefined, { hidden: true })
    .find((group) => group.tagName === 'DETAILS');
  /** Text standing alone in one element, as a raw value would. */
  const bare = [...form.querySelectorAll('*')].filter(
    (element) =>
      element.children.length === 0 &&
      /^(true|false|ordered|free)$/.test(element.textContent ?? ''),
  );
  assert({
    given: 'the host settings form',
    should:
      'show prep before the disclosure, keep speech times and rules inside it, and name every choice in words',
    actual: [
      text.indexOf('Prep before the round') < disclosure,
      text.indexOf('Prep time during the round') < disclosure,
      text.indexOf('Speech times') > disclosure,
      text.indexOf('Ending a speech early') > disclosure,
      [
        details !== undefined,
        details?.textContent?.includes('Speech times'),
        details?.textContent?.includes('Ending a speech early'),
      ].every(Boolean),
      text.includes('cross ex only') || bare.length > 0,
      form.querySelector('[step="0.001"]') !== null,
    ],
    expected: [true, true, true, true, true, false, false],
  });
});

test('a settings save whose answer was lost is saved again as a new command on the latest room', async () => {
  const posted = (
    view: typeof assemblySnapshot,
    commandId: string,
    state: FormFields,
  ) => {
    const form = nativeInputFields(
      renderFields({ view, commandId, state, pending: false }).form,
    );
    form.set('yield', 'off');
    return form;
  };
  const recorded = { ...assemblySnapshot, version: 4, changeVersion: 4 };
  const commands: (readonly [unknown, unknown])[] = [];
  const lost = await saveSettings(
    {
      read: async () => ({ kind: 'found', view: assemblySnapshot }),
      submit: async (command) => commandUnavailable(command),
    },
    posted(assemblySnapshot, 'a'.repeat(24), { values: {}, error: undefined }),
  );
  const shown = roomEditFields(lost);
  const again = await saveSettings(
    {
      read: async () => ({ kind: 'found', view: recorded }),
      submit: async (command) => {
        commands.push([
          command.get('commandId'),
          command.get('expectedVersion'),
        ]);
        return roomAccepted(recorded);
      },
    },
    posted(recorded, 'b'.repeat(24), shown),
  );
  assert({
    given:
      'a save at version three that the room recorded as version four and whose answer was lost, then the same form saved again once room sync has shown version four',
    should:
      'keep what was typed without the first save’s command identifier or version, and post a new command against version four, which the room accepts',
    actual: [
      lost.kind,
      'commandId' in shown.values || 'expectedVersion' in shown.values,
      shown.values['duration.countdown'],
      commands,
      again.kind,
    ],
    expected: [
      'unacknowledged',
      false,
      posted(assemblySnapshot, 'a'.repeat(24), {
        values: {},
        error: undefined,
      }).get('duration.countdown'),
      [['b'.repeat(24), '4']],
      'accepted',
    ],
  });
});
