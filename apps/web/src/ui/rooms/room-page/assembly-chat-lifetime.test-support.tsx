import { useState } from 'react';
import { useResource } from '../../edge/use-driver';
import { assemblySnapshot } from '../../../features/rooms/assembly.test-support';
import { AssemblyDeviceReadiness } from './assembly-device-readiness';
import { idle } from '../../../features/forms/form-state';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';
const pending: (() => void)[] = [];
export const discoveryCount = () => pending.length;
export const finishFirstDiscovery = () => pending[0]?.();
function PendingChat() {
  const [status, setStatus] = useState('Loading Room chat');
  useResource('discovery', () => {
    let present = true;
    pending.push(() => {
      if (present) setStatus('Recovered Room chat');
    });
    return {
      dispose: () => {
        present = false;
      },
    };
  });
  return <output>{status}</output>;
}

export function AssemblyWithPendingChat() {
  const actorId = assemblySnapshot.hostActorId;
  const view = {
    ...assemblySnapshot,
    capabilities: { ...assemblySnapshot.capabilities, canReady: true },
    participants: [
      {
        id: 'p'.repeat(24),
        actorId,
        kind: 'human' as const,
        label: 'Host',
        seat: { kind: 'side' as const, side: 'affirmative' as const, slot: 0 },
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
  return (
    <AssemblyDeviceReadiness
      main={() => <div>Roster</div>}
      aside={<div>Controls</div>}
      chat={<PendingChat />}
      view={view}
      actorId={actorId}
      action={async () => idle()}
      waiverAction={async () => idle()}
      read={async () => ({ kind: 'found', view })}
      send={async () => ({ kind: 'unavailable' })}
      commandIds={{ ready: 'r', unready: 'u', 'start-round': 's' }}
    />
  );
}
