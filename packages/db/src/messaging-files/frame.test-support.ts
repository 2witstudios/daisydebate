import type { SQL } from 'bun';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createAppError } from '@daisy/errors';
import { messagingFiles } from '../schema/messaging-files';
import { messagingMessages } from '../schema/messaging-messages';
import { channelFileFrame } from './frame';
import type { FilePolicy } from './records';

export const fileFramePolicy: FilePolicy = {
  maxFileBytes: 100,
  maxStoredBytes: 200,
  maxStoredFiles: 2,
  maxFilesPerMessage: 1,
  reservationMs: 1000,
  accessMs: 100,
  maxFilenameUnits: 50,
  maxImagePixels: 100,
  serviceMs: 1000,
};
export const fileFrameScope = {
  actorId: 'a'.repeat(24),
  userId: 'u'.repeat(24),
  channelId: 'c'.repeat(24),
};
export const fileFrameNow = '2026-10-09T18:00:00.000Z';
export const fileFrameCommand = {
  id: 'f'.repeat(24),
  objectKey: 'o'.repeat(24),
  requestId: 'r'.repeat(24),
  bytes: 60,
  filename: 'notes.pdf',
  mime: 'application/pdf' as const,
};
export const fileFrameToken = { fileId: fileFrameCommand.id, generation: 1 };
export const fileFrameMessage = 'm'.repeat(24);
type FileRow = typeof messagingFiles.$inferSelect;
export function fileRow(overrides: Partial<FileRow> = {}): unknown[][] {
  const row: FileRow = {
    id: fileFrameCommand.id,
    objectKey: fileFrameCommand.objectKey,
    channelId: fileFrameScope.channelId,
    ownerActorId: fileFrameScope.actorId,
    requestId: fileFrameCommand.requestId,
    messageId: null,
    filename: fileFrameCommand.filename,
    mime: fileFrameCommand.mime,
    reservedBytes: fileFrameCommand.bytes,
    storedBytes: null,
    generation: 1,
    authorityRevision: 4,
    lifecycle: 'reserved',
    createdAt: new Date(fileFrameNow),
    expiresAt: new Date(Date.parse(fileFrameNow) + 1000),
    deletedAt: null,
    ...overrides,
  };
  return [
    Object.keys(getTableColumns(messagingFiles)).map(
      (key) => row[key as keyof FileRow],
    ),
  ];
}

export function fileMessageRow(
  overrides: Partial<typeof messagingMessages.$inferSelect> = {},
): unknown[][] {
  const row: typeof messagingMessages.$inferSelect = {
    id: fileFrameMessage,
    channelId: fileFrameScope.channelId,
    authorActorId: fileFrameScope.actorId,
    sequence: 1,
    changeVersion: 1,
    text: 'Attachment message',
    replyToMessageId: null,
    createdAt: new Date(fileFrameNow),
    editedAt: null,
    removedAt: null,
    ...overrides,
  };
  return [
    Object.keys(getTableColumns(messagingMessages)).map(
      (key) => row[key as keyof typeof row],
    ),
  ];
}

/** Only the driver is scripted. Production Drizzle builds, binds and maps every query. */
export function fileFrameFixture(responses: unknown[][][]) {
  const calls: { query: string; params: unknown[] }[] = [];
  const state = { allowed: true, authorizations: 0 };
  const remaining = [...responses];
  const answer = (query: string, params: unknown[] = []) => {
    calls.push({ query, params });
    const rows = remaining.shift();
    if (!rows) throw new Error('Unexpected file adapter query');
    return Object.assign(Promise.resolve(rows), { values: async () => rows });
  };
  const client = Object.assign(
    (query: TemplateStringsArray, ...params: unknown[]) =>
      answer(query.join('?'), params),
    { options: {}, unsafe: answer },
  ) as unknown as SQL;
  const tx = drizzle({ client });
  const counters = { channelId: fileFrameScope.channelId, changeVersion: 10 };
  const frame = channelFileFrame(tx, fileFrameScope, counters, async () => {
    state.authorizations++;
    if (!state.allowed) throw createAppError('AUTHORIZATION');
  });
  const writes = () =>
    calls.filter(({ query }) => /^(insert|update)/u.test(query));
  return { frame, calls, writes, state, counters, remaining };
}
