import { idle } from '../../../features/forms/form-state';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import type { ReactNode } from 'react';
import { AssemblyDeviceReadiness } from './assembly-device-readiness';

setupRitewayBun();
const actorId = assemblySnapshot.hostActorId;
const nativeProps = {
  main: (start: ReactNode) => <div data-roster>{start}</div>,
  aside: <div data-aside />,
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
          seat:
            role === 'judge'
              ? ({ kind: 'judge', slot: 0 } as const)
              : ({ kind: 'side', side: role, slot: 0 } as const),
          teamOpen: false,
          positionOpen: false,
          rating: null,
          division: null,
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
        html.includes('data-roster'),
      ],
      expected: [true, role !== 'judge', false, role !== 'judge', true],
    });
  });
}

test('the Room chat sits under the roster for a viewer with no devices (RCHAT-9)', () => {
  const chat = <section aria-label="Room chat">thread</section>;
  const visitor = renderToStaticMarkup(
    <AssemblyDeviceReadiness
      {...nativeProps}
      chat={chat}
      view={{
        ...assemblySnapshot,
        capabilities: { ...assemblySnapshot.capabilities, host: false },
      }}
    />,
  );
  const seatlessHost = renderToStaticMarkup(
    <AssemblyDeviceReadiness
      {...nativeProps}
      chat={chat}
      view={assemblySnapshot}
    />,
  );
  assert({
    given: 'a viewer without a seat, with the Room chat, and a seatless host',
    should:
      'show the roster then the chat, then the controls, with no tile or Ready; the host gets only Start round there',
    actual: [
      visitor.indexOf('data-roster') <
        visitor.indexOf('aria-label="Room chat"'),
      visitor.indexOf('aria-label="Room chat"') < visitor.indexOf('data-aside'),
      visitor.includes('aria-label="You"'),
      visitor.includes('I’m ready'),
      [
        seatlessHost.includes('Start round'),
        seatlessHost.includes('I’m ready'),
      ],
    ],
    expected: [true, true, false, false, [true, false]],
  });
});

test('a seated debater has I’m ready under their own tile, above the Room controls (SEAT-8)', () => {
  const view = {
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, canReady: true },
    participants: [
      {
        id: 'p'.repeat(24),
        actorId,
        kind: 'human' as const,
        label: 'Host',
        seat: { kind: 'side', side: 'affirmative', slot: 0 } as const,
        teamOpen: false,
        positionOpen: false,
        rating: null,
        division: null,
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
  const roster = html.indexOf('data-roster');
  const chat = html.indexOf('aria-label="Room chat"');
  const tile = html.indexOf('aria-label="You"');
  const ready = html.indexOf('I’m ready');
  const aside = html.indexOf('data-aside');
  assert({
    given: 'a seated debater with the Room chat',
    should:
      'order roster, chat, their tile with Ready in it, then the controls',
    actual: [roster < chat, chat < tile, tile < ready, ready < aside],
    expected: [true, true, true, true],
  });
});
