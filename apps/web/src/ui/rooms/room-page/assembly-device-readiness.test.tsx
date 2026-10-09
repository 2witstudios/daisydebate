import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblyDeviceReadiness } from './assembly-device-readiness';

setupRitewayBun();
const actorId = assemblySnapshot.hostActorId;
const nativeProps = {
  actorId,
  action: async () => {},
  read: async () => ({ kind: 'found' as const, view: assemblySnapshot }),
  send: async () => ({ kind: 'unavailable' as const }),
  commandIds: {
    ready: 'r',
    unready: 'u',
    'start-round': 's',
    'start-prep': 'p',
    'finish-prep': 'f',
  },
};
for (const role of ['affirmative', 'judge'] as const) {
  test(`no-JS ${role} readiness preserves the device exception`, () => {
    const view = {
      ...assemblySnapshot,
      capabilities: { ...assemblySnapshot.capabilities, canReady: true },
      participants: [
        {
          id: 'p'.repeat(24),
          actorId,
          kind: 'human' as const,
          label: 'Host',
          role,
          slot: 0,
          needsReady: true,
          eligible: true,
          ready: 'not-ready' as const,
          consentVersion: 0,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <AssemblyDeviceReadiness {...nativeProps} view={view} />,
    );
    assert({
      given: `a server-rendered human ${role} with no local checks`,
      should:
        'render native consent with only the debater disabled and no invented preview',
      actual: [
        html.includes('I am ready'),
        (html.match(/<button[^>]*>I am ready<\/button>/)?.[0] ?? '').includes(
          'disabled=""',
        ),
        html.includes('<video'),
      ],
      expected: [true, role !== 'judge', false],
    });
  });
}
