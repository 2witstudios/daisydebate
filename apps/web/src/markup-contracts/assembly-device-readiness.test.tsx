import { idle } from '../features/forms/form-state';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from '../features/rooms/assembly.test-support';
import type { ReactNode } from 'react';
import { renderMarkup } from '../test-support/rendered/markup';
import { AssemblyDeviceReadiness } from '../ui/rooms/room-page/assembly-device-readiness';

setupRitewayBun();
const actorId = assemblySnapshot.hostActorId;

// Markup contract: the reserved preview space is carried only by the
// aspect-room-preview class, which has no accessible equivalent to assert.
test('initial device preview reserves the camera tile’s space (RHS-1)', () => {
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
  const html = renderMarkup(
    <AssemblyDeviceReadiness
      main={(start: ReactNode) => <div>{start}</div>}
      aside={<div />}
      chat={null}
      actorId={actorId}
      action={async () => idle()}
      waiverAction={async () => idle()}
      read={async () => ({ kind: 'found' as const, view: assemblySnapshot })}
      send={async () => ({ kind: 'unavailable' as const })}
      commandIds={{ ready: 'r', unready: 'u', 'start-round': 's' }}
      view={view}
    />,
  );
  assert({
    given: 'a seated debater before browser device resources initialize',
    should:
      'reserve the preview aspect ratio so Settings below it stays in place',
    actual:
      /<[^>]+class="[^"]*aspect-room-preview[^"]*"[^>]*>Checking your camera and microphone…/.test(
        html,
      ),
    expected: true,
  });
});
