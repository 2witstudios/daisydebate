import { idle } from '../../../features/forms/form-state';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import type { ReactNode } from 'react';
import { AssemblyDeviceReadiness } from './assembly-device-readiness';

setupRitewayBun();
const actorId = assemblySnapshot.hostActorId;
const nativeProps = {
  side: (ready: ReactNode) => <div data-side>{ready}</div>,
  chat: null,
  actorId,
  action: async () => idle(),
  waiverAction: async () => idle(),
  read: async () => ({ kind: 'found' as const, view: assemblySnapshot }),
  send: async () => ({ kind: 'unavailable' as const }),
  commandIds: {
    ready: 'r',
    unready: 'u',
    'start-round': 's',
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
        html.includes('I’m ready'),
        (html.match(/<button[^>]*>I’m ready<\/button>/)?.[0] ?? '').includes(
          'disabled=""',
        ),
        html.includes('<video'),
        html.includes('Camera and microphone checks require JavaScript.'),
        html.includes('Start the round'),
      ],
      expected: [true, role !== 'judge', false, role !== 'judge', true],
    });
  });
}

test('the Room chat fills the left column for a viewer with no devices (RCHAT-9)', () => {
  const chat = <section aria-label="Room chat">thread</section>;
  const visitor = renderToStaticMarkup(
    <AssemblyDeviceReadiness
      {...nativeProps}
      chat={chat}
      view={assemblySnapshot}
    />,
  );
  const alone = renderToStaticMarkup(
    <AssemblyDeviceReadiness {...nativeProps} view={assemblySnapshot} />,
  );
  assert({
    given: 'a viewer without a seat, with the Room chat and then without it',
    should:
      'show the chat in the left column with no device section or Ready, and only the side column when there is no chat',
    actual: [
      visitor.includes('room-gathering'),
      visitor.indexOf('aria-label="Room chat"') <
        visitor.indexOf('Start the round'),
      visitor.includes('aria-label="Your devices"'),
      visitor.includes('I’m ready'),
      alone.includes('room-gathering'),
      alone.includes('Start the round'),
    ],
    expected: [true, true, false, false, false, true],
  });
});

test('a seated debater has the Room chat under their devices and Ready in the side column (RCHAT-9, RCHAT-11)', () => {
  const view = {
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, canReady: true },
    participants: [
      {
        id: 'p'.repeat(24),
        actorId,
        kind: 'human' as const,
        label: 'Host',
        role: 'affirmative' as const,
        slot: 0,
        needsReady: true,
        eligible: true,
        ready: 'not-ready' as const,
        consentVersion: 0,
      },
    ],
  };
  const html = renderToStaticMarkup(
    <AssemblyDeviceReadiness
      {...nativeProps}
      chat={<section aria-label="Room chat">thread</section>}
      view={view}
    />,
  );
  const devices = html.indexOf('aria-label="Your devices"');
  const chat = html.indexOf('aria-label="Room chat"');
  const side = html.indexOf('data-side');
  const ready = html.indexOf('I’m ready');
  assert({
    given: 'a seated debater with the Room chat',
    should:
      'order devices, then chat, then the side column, with Ready inside the side column',
    actual: [devices > -1, devices < chat, chat < side, side < ready],
    expected: [true, true, true, true],
  });
});
