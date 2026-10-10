import { createAppError } from '@daisy/errors';
import type {
  FileFrame,
  FileReservation,
  FilePolicy,
} from '@daisy/db/messaging-files';
import { finalizeMessagingFile, type FileDependencies } from './operations';
const fileTestPolicy: FilePolicy = {
  maxFileBytes: 1024,
  maxStoredBytes: 2048,
  maxStoredFiles: 5,
  maxFilesPerMessage: 2,
  reservationMs: 10000,
  accessMs: 100,
  maxFilenameUnits: 50,
  maxImagePixels: 100,
  serviceMs: 1000,
};
export function fileOperationFixture() {
  const channelId = 'c'.repeat(24),
    fileId = 'f'.repeat(24),
    messageId = 'm'.repeat(24);
  const now = '2026-10-09T18:00:00.000Z';
  const reservation: FileReservation = {
    id: fileId,
    lifecycle: 'quarantined',
    channelId,
    ownerActorId: 'a'.repeat(24),
    objectKey: 'o'.repeat(24),
    filename: 'notes.pdf',
    mime: 'application/pdf',
    reservedBytes: 1024,
    generation: 1,
    authorityRevision: 1,
    expiresAt: '2026-10-09T18:00:10.000Z',
  };
  const calls: string[] = [];
  const state = { allowed: true, now, commits: 0, cleanup: 0 };
  let releaseScan: (value: 'clean' | 'infected') => void = () => {
    throw new Error('Scan not started');
  };
  let scanned: () => void = () => {
    throw new Error('Scan waiter not installed');
  };
  const scanStarted = new Promise<void>((resolve) => {
    scanned = resolve;
  });
  const frame: FileFrame = {
    authorize: async () => {
      if (!state.allowed) throw createAppError('AUTHORIZATION');
    },
    reserve: async () => reservation,
    upload: async () => reservation,
    scan: async () => {
      calls.push('protected-read');
      return reservation;
    },
    quarantine: async () => {
      state.commits++;
    },
    renew: async () => reservation,
    finalize: async () => {
      calls.push('finalize');
      state.commits++;
    },
    access: async () => ({
      ...reservation,
      lifecycle: 'attached',
      messageId,
      storedBytes: 20,
      accessExpiresAt: '2026-10-09T18:00:00.100Z',
    }),
    cancel: async () => {
      state.commits++;
    },
  };
  const d: FileDependencies = {
    policy: fileTestPolicy,
    clock: { now: () => state.now },
    ids: { next: () => fileId },
    store: {
      withChannel: async (_scope, capability, work) => {
        calls.push(capability);
        if (!state.allowed) throw createAppError('AUTHORIZATION');
        return work(frame);
      },
    },
    objects: {
      put: async () => {
        calls.push('write');
      },
      read: async () => new TextEncoder().encode('%PDF-1.7\nhello\n%%EOF'),
      remove: async () => {
        calls.push('delete');
      },
    },
    scanner: {
      scan: async () => {
        scanned();
        return new Promise((resolve) => {
          releaseScan = resolve;
        });
      },
    },
    sanitizeImage: async (bytes) => bytes,
    failPending: async () => {
      state.cleanup++;
    },
  };
  return {
    channelId,
    fileId,
    messageId,
    reservation,
    calls,
    state,
    frame,
    d,
    scanStarted,
    completeScan: (value: 'clean' | 'infected') => releaseScan(value),
    principal: {
      kind: 'user' as const,
      userId: 'u'.repeat(24),
      actorId: reservation.ownerActorId,
    },
    input: { version: 1, channelId, fileId, messageId, generation: 1 },
  };
}

export async function finalizeAfterCleanScan(
  fixture: ReturnType<typeof fileOperationFixture>,
  dependencies: FileDependencies = fixture.d,
) {
  const pending = finalizeMessagingFile(
    fixture.input,
    fixture.principal,
    dependencies,
  );
  await fixture.scanStarted;
  fixture.completeScan('clean');
  return pending;
}
