import type { DoctorCheck } from './doctor';

/** Fixed loopback health endpoint for the one shared local SFU. */
export async function checkLivekit(
  probe: () => Promise<boolean> = async () => {
    const response = await fetch('http://127.0.0.1:7880/', {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok && (await response.text()).trim() === 'OK';
  },
): Promise<DoctorCheck> {
  try {
    if (await probe())
      return { name: 'livekit', status: 'pass', detail: 'reachable' };
  } catch {
    // Probe failures expose only the local recovery command.
  }
  return {
    name: 'livekit',
    status: 'fail',
    detail:
      'unreachable (run docker compose -f infra/compose.yaml up -d livekit)',
  };
}
