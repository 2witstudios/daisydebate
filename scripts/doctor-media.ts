import { readMediaWorkerConfig } from '@daisy/config';
import { createMediaWorkerDatabase } from '@daisy/db/media-worker';
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

const privilegeProblems = async (url: string) => {
  const database = createMediaWorkerDatabase({ url });
  try {
    return await database.privilegeProblems();
  } finally {
    await database.close();
  }
};

/** The capture worker is optional locally; reports name fields, never values. */
export async function checkMediaWorker(
  env: Readonly<Record<string, string | undefined>>,
  problems: (url: string) => Promise<readonly string[]> = privilegeProblems,
): Promise<DoctorCheck> {
  let url: string;
  try {
    url = readMediaWorkerConfig(env).MEDIA_WORKER_DATABASE_URL;
  } catch (error) {
    const fields = String((error as Error).message).split(': ')[1] ?? '';
    return {
      name: 'media-worker',
      status: 'warn',
      detail: `not configured: ${fields}`,
    };
  }
  let found: readonly string[];
  try {
    found = await problems(url);
  } catch {
    return {
      name: 'media-worker',
      status: 'fail',
      detail: 'database unreachable (run bun slot:up)',
    };
  }
  return found.length === 0
    ? {
        name: 'media-worker',
        status: 'pass',
        detail: 'configured as daisy_media_worker',
      }
    : {
        name: 'media-worker',
        status: 'fail',
        detail: `login broader than daisy_media_worker: ${found.join(', ')}`,
      };
}
