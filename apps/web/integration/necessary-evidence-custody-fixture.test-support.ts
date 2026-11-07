import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initializeLocalEvidenceAuthority,
  openLocalEvidenceAuthority,
  type EvidenceAuthority,
} from '../src/features/media-capture/local-evidence-authority';
import { openLocalEvidenceCustody } from '../src/features/media-capture/local-evidence-custody';
export const identity = {
  authorityId: 'c'.repeat(24),
  evidenceId: 'a'.repeat(24),
  bindingDigest: 'b'.repeat(64),
};
export const payload = new Uint8Array([1, 2, 3, 4]);
export const privacyScope = {
  roundId: 'd'.repeat(24),
  subjectActorIds: ['e'.repeat(24)],
};
export async function fixture(
  work: (f: {
    readonly authority: ReturnType<typeof openLocalEvidenceAuthority>;
    readonly connect: (
      authority?: EvidenceAuthority,
    ) => ReturnType<typeof openLocalEvidenceCustody>;
    readonly advance: (time: number) => void;
    readonly removeMaterial: () => Promise<void>;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'daisy-custody-fences-'));
  let now = 1000;
  const path = join(dir, 'authority.sqlite');
  initializeLocalEvidenceAuthority({ path, authorityId: 'c'.repeat(24) });
  const authority = openLocalEvidenceAuthority({
    path,
    authorityId: 'c'.repeat(24),
    nowMs: () => now,
  });
  const clients: ReturnType<typeof openLocalEvidenceCustody>[] = [];
  try {
    await work({
      authority,
      advance: (time) => {
        now = time;
      },
      removeMaterial: () => rm(join(dir, 'keys.sqlite')),
      connect: (current = authority) => {
        const client = openLocalEvidenceCustody({
          path: join(dir, 'keys.sqlite'),
          authority: current,
        });
        clients.push(client);
        return client;
      },
    });
  } finally {
    for (const client of clients) client.close();
    authority.close();
    await rm(dir, { recursive: true, force: true });
  }
}
