import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblySettingsFields } from './assembly-settings-form';

setupRitewayBun();

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
      html.includes('name="duration.N3.minutes"'),
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
          'duration.N3.minutes': '02',
          'duration.N3.seconds': '03.456',
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
