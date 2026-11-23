import { idle } from '../../../features/forms/form-state';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import type { ReactNode } from 'react';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { AssemblyDeviceReadiness } from './assembly-device-readiness';

setupRitewayBun();
/** Whether `second` comes after `first` in document order (or inside it). */
const follows = (first: Element, second: Element) =>
  // Node.DOCUMENT_POSITION_FOLLOWING
  (first.compareDocumentPosition(second) & 4) !== 0;
const actorId = assemblySnapshot.hostActorId;
const nativeProps = {
  main: (start: ReactNode) => <section aria-label="Roster">{start}</section>,
  aside: <aside aria-label="Room controls" />,
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
  test(`server-rendered ${role} readiness preserves the device exception`, () => {
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
          ageBand: null,
          needsReady: true,
          eligible: true,
          ready: 'not-ready' as const,
          consentVersion: 0,
        },
      ],
    };
    const rendered = renderAccessible(
      <main>
        <AssemblyDeviceReadiness {...nativeProps} view={view} />
      </main>,
    );
    const action = role === 'judge' ? 'I’m ready' : 'Turn on camera and mic';
    assert({
      given: `a server-rendered human ${role} with no local checks`,
      should:
        'keep the judge’s native consent and the debater’s disabled device action, without opening a camera',
      actual: [
        rendered.has('button', action),
        rendered.get('button', action).hasAttribute('disabled'),
        // A video has no role; the page around it is asked whether it holds one.
        rendered.get('main').querySelector('video') !== null,
        rendered.textContent().includes('Checking your camera and microphone…'),
        rendered.has('region', 'Roster'),
      ],
      expected: [true, role !== 'judge', false, role !== 'judge', true],
    });
  });
}

test('the Room chat sits under the roster for a viewer with no devices (RCHAT-9)', () => {
  const chat = <section aria-label="Room chat">thread</section>;
  const visitor = renderAccessible(
    <AssemblyDeviceReadiness
      {...nativeProps}
      chat={chat}
      view={{
        ...assemblySnapshot,
        capabilities: { ...assemblySnapshot.capabilities, host: false },
      }}
    />,
  );
  const seatlessHost = renderAccessible(
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
      follows(
        visitor.get('region', 'Roster'),
        visitor.get('region', 'Room chat'),
      ),
      follows(
        visitor.get('region', 'Room chat'),
        visitor.get('complementary', 'Room controls'),
      ),
      visitor.has('region', 'You'),
      visitor.textContent().includes('I’m ready'),
      [
        seatlessHost.textContent().includes('Start round'),
        seatlessHost.textContent().includes('I’m ready'),
      ],
    ],
    expected: [true, true, false, false, [true, false]],
  });
});

test('a seated debater has Turn on under their own tile, above the Room controls (SEAT-8)', () => {
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
        ageBand: null,
        needsReady: true,
        eligible: true,
        ready: 'not-ready' as const,
        consentVersion: 0,
      },
    ],
  };
  const rendered = renderAccessible(
    <AssemblyDeviceReadiness
      {...nativeProps}
      chat={<section aria-label="Room chat">thread</section>}
      view={view}
    />,
  );
  const roster = rendered.get('region', 'Roster');
  const chat = rendered.get('region', 'Room chat');
  const tile = rendered.get('region', 'You');
  const ready = rendered
    .within('region', 'You')
    .get('button', 'Turn on camera and mic');
  const aside = rendered.get('complementary', 'Room controls');
  assert({
    given: 'a seated debater with the Room chat',
    should:
      'order roster, chat, their tile with its device action in it, then the controls',
    actual: [
      follows(roster, chat),
      follows(chat, tile),
      follows(tile, ready),
      follows(ready, aside),
    ],
    expected: [true, true, true, true],
  });
});
